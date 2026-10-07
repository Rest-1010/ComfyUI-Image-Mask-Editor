import base64
import hashlib
import json
from io import BytesIO

import numpy as np
from PIL import Image
import torch

import folder_paths


class ImageMaskEditor:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "paint": ("STRING", {"default": ""}),
            },
            "optional": {"image": ("IMAGE",)},
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    FUNCTION = "edit"
    CATEGORY = "image"
    OUTPUT_NODE = True
    DESCRIPTION = "Paint directly over an input image and return the composite and its paint mask."

    @staticmethod
    def _layer_names(paint):
        if paint.startswith("{"):
            layers = json.loads(paint)
            return layers.get("paint", ""), layers.get("mask", "")
        return paint, ""

    @staticmethod
    def _paint_image(paint):
        if not paint:
            return None
        if paint.startswith("data:image/png;base64,"):
            path = BytesIO(base64.b64decode(paint.split(",", 1)[1], validate=True))
        else:
            if not folder_paths.exists_annotated_filepath(paint):
                raise FileNotFoundError(f"Sketch layer not found: {paint}. Repaint the layer and run again.")
            path = folder_paths.get_annotated_filepath(paint)
        with Image.open(path) as image:
            return image.convert("RGBA")

    @staticmethod
    def _source_data_url(image):
        array = np.clip(image.cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
        source = Image.fromarray(array, mode="RGB")
        buffer = BytesIO()
        source.save(buffer, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

    def edit(self, image=None, paint="", unique_id=""):
        state = json.loads(paint) if paint.startswith("{") else {}
        saved_source = self._paint_image(state.get("source", ""))
        incoming = image
        if saved_source is not None:
            image = torch.from_numpy(np.asarray(saved_source.convert("RGB")).copy().astype(np.float32) / 255.0).unsqueeze(0)
        if image is None:
            raise ValueError("画像を読み込み、Send inpaintを押してから実行してね。")
        paint_name, mask_name = self._layer_names(paint)
        paint_image = self._paint_image(paint_name)
        mask_image = self._paint_image(mask_name)
        output_images = []
        output_masks = []

        for source in image:
            source_size = (source.shape[1], source.shape[0])

            if paint_image is None and mask_image is None:
                output_images.append(source)
                output_masks.append(torch.zeros(source.shape[:2], dtype=torch.float32))
                continue

            mask_array = np.zeros(source.shape[:2], dtype=np.float32)
            output = source
            for layer, composite in ((paint_image, True), (mask_image, False)):
                if layer is None:
                    continue
                if layer.size != source_size:
                    layer = layer.resize(source_size, Image.Resampling.BILINEAR)
                alpha = np.asarray(layer.getchannel("A")).astype(np.float32) / 255.0
                mask_array = 1.0 - (1.0 - mask_array) * (1.0 - alpha)
                if composite:
                    layer_rgb = torch.from_numpy(np.asarray(layer.convert("RGB")).astype(np.float32) / 255.0).to(source)
                    layer_alpha = torch.from_numpy(alpha).to(source).unsqueeze(-1)
                    output = source * (1.0 - layer_alpha) + layer_rgb * layer_alpha
            output_images.append(output)
            output_masks.append(torch.from_numpy(mask_array))

        return {
            "ui": {"image_mask_editor_source": [self._source_data_url(incoming[0])] if incoming is not None else []},
            "result": (torch.stack(output_images), torch.stack(output_masks), int(image.shape[2]), int(image.shape[1])),
        }

    @classmethod
    def IS_CHANGED(cls, image=None, paint="", unique_id=""):
        digest = hashlib.sha256()
        digest.update(paint.encode("utf-8"))
        for name in cls._layer_names(paint):
            digest.update(name.encode("utf-8"))
            if name and not name.startswith("data:") and folder_paths.exists_annotated_filepath(name):
                with open(folder_paths.get_annotated_filepath(name), "rb") as file:
                    digest.update(file.read())
        return digest.hexdigest()


class ImageMaskEditorPreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "target": ("STRING", {"default": ""})}}

    RETURN_TYPES = ()
    FUNCTION = "preview"
    CATEGORY = "image"
    OUTPUT_NODE = True
    DESCRIPTION = "Send a decoded generation result to an Image & Mask Editor's left preview without creating a graph cycle."

    def preview(self, image, target):
        return {"ui": {"image_mask_editor_preview": [ImageMaskEditor._source_data_url(image[0])], "target": [target]}, "result": ()}
