from .image_mask_editor import ImageMaskEditor, ImageMaskEditorPreview

WEB_DIRECTORY = "web"

NODE_CLASS_MAPPINGS = {
    "ImageMaskEditor": ImageMaskEditor,
    "ImageMaskEditorPreview": ImageMaskEditorPreview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageMaskEditor": "Image & Mask Editor",
    "ImageMaskEditorPreview": "Image & Mask Editor — Result Preview",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
