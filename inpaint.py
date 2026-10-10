import math

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter
import torch
import torch.nn.functional as F


def blur_mask(mask, sigma):
    if sigma == 0:
        return mask.clone()
    radius = int(2.5 * sigma + 0.5)
    offsets = np.arange(-radius, radius + 1, dtype=np.float32)
    weights = np.exp(-0.5 * (offsets / sigma) ** 2)
    weights /= weights.sum()
    arrays = []
    for plane in mask.cpu().numpy():
        for axis in (1, 0):
            padding = [(0, 0), (0, 0)]
            padding[axis] = (radius, radius)
            plane = np.apply_along_axis(lambda row: np.convolve(row, weights, mode="valid"), axis,
                                       np.pad(plane, padding, mode="reflect"))
        arrays.append(plane)
    return torch.from_numpy(np.stack(arrays)).to(mask)


def fill_masked(image, mask):
    arrays = []
    for pixels, alpha in zip(image.cpu().numpy(), mask.cpu().numpy()):
        region = alpha >= 0.5
        if region.all():
            fill = np.full_like(pixels, 0.5)
        elif region.any():
            nearest = distance_transform_edt(region, return_distances=False, return_indices=True)
            fill = pixels[tuple(nearest)]
            fill = gaussian_filter(fill, sigma=(max(1, min(region.shape) / 64),) * 2 + (0,), mode="nearest")
        else:
            fill = pixels
        arrays.append(pixels * (1 - alpha[..., None]) + fill * alpha[..., None])
    return torch.from_numpy(np.stack(arrays)).to(image)


def padded_bounds(low, high, limit):
    length = min(limit, max(8, ((high - low + 7) // 8) * 8))
    low = max(0, min(low - (length - (high - low)) // 2, limit - length))
    return low, low + length


def generation_dimensions(height, width, reference_size):
    scale = reference_size / math.sqrt(height * width)
    return max(8, round(height * scale / 8) * 8), max(8, round(width * scale / 8) * 8)


class InpaintPrepare:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",), "mask": ("MASK",), "original": ("IMAGE",),
            "inpaint_area": (["Whole picture", "Only masked"], {"default": "Only masked"}),
            "padding": ("INT", {"default": 32, "min": 0, "max": 4096}),
            "masked_content": (["original", "fill"],),
            "mask_blur": ("INT", {"default": 4, "min": 0, "max": 64}),
            "generation_size": (["512×512", "768×768", "1024×1024", "Custom"], {"default": "1024×1024"}),
            "custom_size": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8,
                                     "tooltip": "Customのみで使用します。1024は1024×1024相当の画素数です。"}),
        }}

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE_MASK_EDITOR_COMPOSITE")
    RETURN_NAMES = ("image", "mask", "composite")
    FUNCTION = "prepare"
    CATEGORY = "image/inpaint"
    DESCRIPTION = "Resize the image and mask to a target pixel count while keeping their aspect ratio. Connect composite to Inpaint Composite."

    def prepare(self, image, original, mask, inpaint_area="Whole picture", padding=32,
                masked_content="original", mask_blur=4, generation_size="1024×1024", custom_size=1024):
        if image.shape != original.shape:
            raise ValueError("imageとoriginalには同じサイズ・枚数の画像を接続してください。")
        height, width = image.shape[1:3]
        mask = F.interpolate(mask.reshape(-1, 1, *mask.shape[-2:]).to(image), (height, width), mode="bilinear", align_corners=False)[:, 0]
        if mask.shape[0] == 1:
            mask = mask.expand(image.shape[0], -1, -1)
        if mask.shape[0] != image.shape[0]:
            raise ValueError("画像とマスクの枚数を合わせてください。")
        mask = blur_mask(mask, mask_blur)
        nonzero = torch.nonzero(mask.any(dim=0), as_tuple=False)
        empty = nonzero.numel() == 0
        x1, y1, x2, y2 = 0, 0, width, height
        if inpaint_area == "Only masked" and not empty:
            y1, x1 = nonzero.amin(dim=0).tolist()
            y2, x2 = (nonzero.amax(dim=0) + 1).tolist()
            x1, x2 = padded_bounds(max(0, x1 - padding), min(width, x2 + padding), width)
            y1, y2 = padded_bounds(max(0, y1 - padding), min(height, y2 + padding), height)
        prepared = fill_masked(image, mask) if masked_content == "fill" else image
        prepared = prepared[:, y1:y2, x1:x2].clone()
        prepared_mask = mask[:, y1:y2, x1:x2].clone()
        pad_x, pad_y = (-(x2 - x1)) % 8, (-(y2 - y1)) % 8
        if pad_x or pad_y:
            prepared = F.pad(prepared.movedim(-1, 1), (0, pad_x, 0, pad_y), mode="replicate").movedim(1, -1)
            prepared_mask = F.pad(prepared_mask, (0, pad_x, 0, pad_y))
        context = {"original": original, "mask": mask, "bounds": (x1, y1, x2, y2),
                   "prepared_size": prepared.shape[1:3], "area": inpaint_area, "empty": empty}
        if inpaint_area == "Only masked":
            reference = custom_size if generation_size == "Custom" else int(generation_size.split("×")[0])
            target_size = generation_dimensions(*prepared.shape[1:3], reference)
            if prepared.shape[1:3] != target_size:
                prepared = F.interpolate(prepared.movedim(-1, 1), target_size, mode="bilinear", align_corners=False, antialias=True).movedim(1, -1)
                prepared_mask = F.interpolate(prepared_mask.unsqueeze(1), target_size, mode="bilinear", align_corners=False, antialias=True)[:, 0]
        return prepared, prepared_mask, context


class InpaintComposite:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "composite": ("IMAGE_MASK_EDITOR_COMPOSITE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "compose"
    CATEGORY = "image/inpaint"
    DESCRIPTION = "Blend decoded inpaint results into the unpainted original at its original size."

    def compose(self, image, composite):
        original = composite["original"]
        if composite["empty"]:
            return (original.clone(),)
        if image.shape[0] != original.shape[0]:
            if original.shape[0] != 1:
                raise ValueError("生成画像と元画像の枚数を合わせてください。")
            original = original.expand(image.shape[0], -1, -1, -1)
        generated = image.to(original)
        size = composite["prepared_size"]
        if generated.shape[1:3] != size:
            generated = F.interpolate(generated.movedim(-1, 1), size, mode="bilinear", align_corners=False).movedim(1, -1)
        x1, y1, x2, y2 = composite["bounds"]
        generated = generated[:, :y2-y1, :x2-x1]
        alpha = composite["mask"][:, y1:y2, x1:x2].to(original).unsqueeze(-1)
        if composite["area"] == "Whole picture":
            alpha = (alpha * 2).clamp(0, 1)
        output = original.clone()
        destination = output[:, y1:y2, x1:x2]
        destination.copy_(generated * alpha + destination * (1 - alpha))
        return (output,)
