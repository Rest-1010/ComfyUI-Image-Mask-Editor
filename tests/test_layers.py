import base64
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch


class SketchLayersTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        resolver = SimpleNamespace(
            exists_annotated_filepath=lambda name: (self.root / name).is_file(),
            get_annotated_filepath=lambda name: str(self.root / name),
        )
        spec = importlib.util.spec_from_file_location(
            "sketch_under_test", Path(__file__).parents[1] / "image_mask_editor.py"
        )
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"folder_paths": resolver,
                                      "comfy.cli_args": SimpleNamespace(args=SimpleNamespace(disable_metadata=False))}):
            spec.loader.exec_module(self.module)
        self.node = self.module.ImageMaskEditor()
        self.source = torch.full((2, 4, 8, 3), 0.25)

    def tearDown(self):
        self.directory.cleanup()

    def save(self, name, array):
        Image.fromarray(array).save(self.root / name)
        return name

    def test_mask_only_leaves_image_exactly_unchanged(self):
        mask = np.zeros((4, 8, 4), dtype=np.uint8)
        mask[1:3, 2:6] = [98, 207, 255, 255]
        name = self.save("mask.png", mask)
        output, result, original = self.node.edit(self.source, json.dumps({"mask": name}), "1")["result"]
        self.assertTrue(torch.equal(original, self.source))
        self.assertTrue(torch.equal(output, self.source))
        self.assertEqual(tuple(result.shape), (2, 4, 8))
        self.assertTrue(torch.equal(result[0], torch.from_numpy(mask[:, :, 3].astype(np.float32) / 255)))

    def test_union_and_color_composite(self):
        paint = np.zeros((4, 8, 4), dtype=np.uint8)
        mask = paint.copy()
        paint[1, 1:4] = [255, 0, 0, 128]
        mask[1, 3:6] = [0, 255, 255, 128]
        value = json.dumps({"paint": self.save("paint.png", paint), "mask": self.save("mask.png", mask)})
        output, result, _ = self.node.edit(self.source, value, "1")["result"]
        alpha = 128 / 255
        self.assertAlmostEqual(result[0, 1, 3].item(), 1 - (1 - alpha) ** 2, places=6)
        self.assertAlmostEqual(result[0, 1, 5].item(), alpha, places=6)
        self.assertTrue(torch.equal(output[:, 1, 5], self.source[:, 1, 5]))
        self.assertGreater(output[0, 1, 1, 0].item(), self.source[0, 1, 1, 0].item())

    def test_legacy_paint_and_resizing(self):
        name = self.save("legacy.png", np.full((2, 4, 4), 255, dtype=np.uint8))
        output, mask, _ = self.node.edit(self.source, name, "1")["result"]
        self.assertEqual(tuple(output.shape), tuple(self.source.shape))
        self.assertTrue(torch.all(output == 1))
        self.assertTrue(torch.all(mask == 1))

    def test_mask_file_changes_invalidate_cache(self):
        name = self.save("mask.png", np.zeros((4, 8, 4), dtype=np.uint8))
        value = json.dumps({"mask": name})
        before = self.node.IS_CHANGED(self.source, value, "1")
        self.save(name, np.full((4, 8, 4), 255, dtype=np.uint8))
        self.assertNotEqual(before, self.node.IS_CHANGED(self.source, value, "1"))

    def test_embedded_mask_replaces_old_mask_without_files(self):
        def value_for(column):
            mask = np.zeros((4, 8, 4), dtype=np.uint8)
            mask[:, column] = [98, 207, 255, 255]
            buffer = BytesIO()
            Image.fromarray(mask).save(buffer, format="PNG")
            return json.dumps({"mask": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")})

        old = value_for(1)
        new = value_for(6)
        _, old_mask, _ = self.node.edit(self.source, old, "1")["result"]
        image, new_mask, _ = self.node.edit(self.source, new, "1")["result"]
        self.assertTrue(torch.all(old_mask[:, :, 1] == 1))
        self.assertTrue(torch.all(new_mask[:, :, 1] == 0))
        self.assertTrue(torch.all(new_mask[:, :, 6] == 1))
        self.assertTrue(torch.equal(image, self.source))
        self.assertNotEqual(self.node.IS_CHANGED(self.source, old, "1"), self.node.IS_CHANGED(self.source, new, "1"))
        self.assertEqual(list(self.root.iterdir()), [])

    def test_missing_old_file_is_not_silently_an_empty_mask(self):
        with self.assertRaises(FileNotFoundError):
            self.node.edit(self.source, "missing-mask.png", "1")

    def test_source_preview_is_in_cacheable_ui_output(self):
        paint = np.full((4, 8, 4), [255, 0, 0, 255], dtype=np.uint8)
        result = self.node.edit(self.source, self.save("paint.png", paint), "1")
        preview = result["ui"]["image_mask_editor_source"][0]
        with Image.open(BytesIO(base64.b64decode(preview.split(",", 1)[1]))) as image:
            self.assertEqual(image.size, (8, 4))
            self.assertEqual(image.getpixel((0, 0)), (63, 63, 63))
        self.assertTrue(torch.all(result["result"][0][:, :, :, 0] == 1))

    def test_uploaded_source_runs_without_image_connection(self):
        source = self.save("source.png", np.full((4, 8, 3), [0, 128, 255], dtype=np.uint8))
        mask = self.save("mask.png", np.full((4, 8, 4), [98, 207, 255, 255], dtype=np.uint8))
        result = self.node.edit(paint=json.dumps({"source": source, "mask": mask}))
        image, masks, original = result["result"]
        self.assertEqual(tuple(original.shape), (1, 4, 8, 3))
        self.assertEqual(tuple(image.shape), (1, 4, 8, 3))
        self.assertEqual(image[0, 0, 0, 2].item(), 1)
        self.assertTrue(torch.all(masks == 1))
        self.assertEqual(result["ui"]["image_mask_editor_source"], [])

    def test_committed_source_is_not_overwritten_by_incoming_preview(self):
        source = self.save("source.png", np.full((4, 8, 3), 255, dtype=np.uint8))
        result = self.node.edit(self.source, json.dumps({"source": source}), "1")
        self.assertTrue(torch.all(result["result"][0] == 1))
        self.assertTrue(result["ui"]["image_mask_editor_source"])
        self.assertNotEqual(self.node.IS_CHANGED(None, json.dumps({"source": source}), "1"),
                            self.node.IS_CHANGED(None, json.dumps({"source": "other.png"}), "1"))

    def test_missing_source_has_actionable_error(self):
        self.assertEqual(self.node.IS_CHANGED(paint=""), self.node.IS_CHANGED(paint=""))
        with self.assertRaisesRegex(ValueError, "Send inpaint"):
            self.node.edit()

    def test_original_follows_editor_source_not_incoming_or_left_preview(self):
        source = self.save("source.png", np.full((5, 13, 3), 128, dtype=np.uint8))
        preview = self.save("preview.png", np.full((7, 9, 3), 64, dtype=np.uint8))
        image, mask, original = self.node.edit(self.source,
            json.dumps({"source": source, "preview": preview}))["result"]
        self.assertEqual(tuple(original.shape), (1, 5, 13, 3))
        self.assertTrue(torch.equal(image, original))

    def test_inline_source_paint_and_mask_execute_without_reading_or_writing_files(self):
        def encode(array):
            buffer = BytesIO()
            Image.fromarray(array).save(buffer, format="PNG")
            return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
        source = np.full((4, 8, 3), 64, dtype=np.uint8)
        paint = np.zeros((4, 8, 4), dtype=np.uint8)
        paint[1, 2] = [255, 0, 0, 255]
        mask = np.zeros_like(paint)
        mask[2, 4] = [98, 207, 255, 255]
        state = json.dumps({"source":encode(source), "paint":encode(paint), "mask":encode(mask)})
        with patch.object(self.module.folder_paths, "exists_annotated_filepath", side_effect=AssertionError("Unexpected file lookup")):
            image, result, original = self.node.edit(paint=state)["result"]
        self.assertEqual(tuple(original.shape), (1, 4, 8, 3))
        self.assertNotEqual(original[0, 1, 2, 0].item(), 1)
        self.assertEqual(image[0, 1, 2, 0].item(), 1)
        self.assertEqual(result[0, 1, 2].item(), 1)
        self.assertEqual(result[0, 2, 4].item(), 1)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_result_receiver_is_display_only(self):
        result = self.module.ImageMaskEditorPreview().preview(self.source, "2: Image & Mask Editor")
        self.assertEqual(result["result"], ())
        self.assertEqual(result["ui"]["target"], ["2: Image & Mask Editor"])
        self.assertTrue(result["ui"]["image_mask_editor_preview"][0].startswith("data:image/png;base64,"))

    def test_only_paint_mask_expands_without_expanding_color_or_blurring(self):
        source = torch.zeros((1, 128, 128, 3))
        paint = np.zeros((128, 128, 4), dtype=np.uint8)
        paint[:, 64] = [255, 0, 0, 255]
        mask = np.zeros_like(paint)
        mask[20, 20] = [0, 255, 255, 255]
        state = {"paint": self.save("paint.png", paint), "mask": self.save("mask.png", mask)}
        sharp = self.node.edit(source, json.dumps(state))["result"]
        state["expand"] = False
        unexpanded = self.node.edit(source, json.dumps(state))["result"]
        self.assertTrue(torch.equal(sharp[0], unexpanded[0]))
        self.assertEqual(sharp[1][0, 50, 63].item(), 1)
        self.assertEqual(sharp[1][0, 50, 62].item(), 0)
        self.assertEqual(unexpanded[1][0, 50, 63].item(), 0)
        self.assertEqual(sharp[1][0, 20, 19].item(), 0)
        self.assertEqual(sharp[0][0, 50, 63, 0].item(), 0)
        self.assertTrue(torch.equal(sharp[2], source))

    def test_preview_png_contains_execution_snapshot_and_workflow(self):
        prompt = {"1":{"class_type":"Sampler", "inputs":{"seed":42}}}
        extra = {"workflow":{"nodes":[{"id":1}]}}
        result = self.module.ImageMaskEditorPreview().preview(self.source, "1", prompt, extra)
        encoded = result["ui"]["image_mask_editor_preview"][0]
        prompt["1"]["inputs"]["seed"] = 99
        with Image.open(BytesIO(base64.b64decode(encoded.split(",",1)[1]))) as image:
            self.assertEqual(json.loads(image.info["prompt"])["1"]["inputs"]["seed"], 42)
            self.assertEqual(json.loads(image.info["workflow"]), extra["workflow"])

    def test_metadata_disable_setting_is_respected(self):
        self.module.args.disable_metadata = True
        url = self.module.ImageMaskEditorPreview().preview(self.source, "1", {"1":{}}, {"workflow":{}})["ui"]["image_mask_editor_preview"][0]
        with Image.open(BytesIO(base64.b64decode(url.split(",",1)[1]))) as image:
            self.assertNotIn("prompt", image.info)
            self.assertNotIn("workflow", image.info)


if __name__ == "__main__":
    unittest.main()
