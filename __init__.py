from .image_mask_editor import ImageMaskEditor, ImageMaskEditorPreview
from .inpaint import InpaintPrepare, InpaintComposite

WEB_DIRECTORY = "web"

NODE_CLASS_MAPPINGS = {
    "ImageMaskEditor": ImageMaskEditor,
    "ImageMaskEditorPreview": ImageMaskEditorPreview,
    "ImageMaskEditorPrepare": InpaintPrepare,
    "ImageMaskEditorComposite": InpaintComposite,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageMaskEditor": "Image & Mask Editor",
    "ImageMaskEditorPreview": "Image & Mask Editor — Result Preview",
    "ImageMaskEditorPrepare": "Image & Mask Editor — Inpaint Prepare",
    "ImageMaskEditorComposite": "Image & Mask Editor — Inpaint Composite",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
