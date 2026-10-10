import importlib.util
from pathlib import Path
import unittest

import torch

spec = importlib.util.spec_from_file_location("inpaint_under_test", Path(__file__).parents[1] / "inpaint.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InpaintTest(unittest.TestCase):
    def setUp(self):
        self.prepare = module.InpaintPrepare()
        self.compose = module.InpaintComposite()
        self.original = torch.full((1, 64, 80, 3), 0.25)
        self.paint = self.original.clone()
        self.paint[:, 20:28, 30:38] = 1
        self.mask = torch.zeros((1, 64, 80))
        self.mask[:, 20:28, 30:38] = 1

    def test_only_masked_crop_has_no_scaling_and_restores_position(self):
        pixels, mask, context = self.prepare.prepare(self.paint, self.original, self.mask, "Only masked", 0, "original", 0,
                                                     generation_size="Custom", custom_size=8)
        self.assertEqual(tuple(pixels.shape), (1, 8, 8, 3))
        self.assertTrue(torch.all(pixels == 1))
        self.assertEqual(context["bounds"], (30, 20, 38, 28))
        generated = torch.zeros_like(pixels)
        output = self.compose.compose(generated, context)[0]
        expected = self.original.clone()
        expected[:, 20:28, 30:38] = 0
        self.assertTrue(torch.equal(output, expected))
        self.assertTrue(torch.all(self.original == 0.25))

    def test_padding_and_eight_pixel_alignment_never_drop_mask(self):
        pixels, mask, context = self.prepare.prepare(self.paint, self.original, self.mask, "Only masked", 3, "original", 0,
                                                     generation_size="Custom", custom_size=16)
        self.assertEqual(tuple(pixels.shape[1:3]), (16, 16))
        self.assertEqual(mask.sum().item(), 64)
        self.assertTrue(torch.equal(self.compose.compose(pixels, context)[0], self.paint))

    def test_whole_picture_doubles_only_composite_mask(self):
        mask = torch.full_like(self.mask, 0.3)
        pixels, generation_mask, context = self.prepare.prepare(self.paint, self.original, mask, mask_blur=0,
                                                               generation_size="Custom", custom_size=72)
        self.assertTrue(torch.equal(generation_mask, mask))
        output = self.compose.compose(torch.ones_like(pixels), context)[0]
        self.assertTrue(torch.allclose(output, torch.full_like(output, 0.7)))

    def test_only_masked_does_not_double_composite_mask(self):
        mask = torch.full_like(self.mask, 0.3)
        pixels, _, context = self.prepare.prepare(self.paint, self.original, mask, "Only masked", 0, "original", 0)
        output = self.compose.compose(torch.ones_like(pixels), context)[0]
        self.assertTrue(torch.allclose(output, torch.full_like(output, 0.475)))

    def test_empty_masks_return_original_even_with_generated_pixels(self):
        for area in ("Only masked", "Whole picture"):
            pixels, _, context = self.prepare.prepare(self.paint, self.original, torch.zeros_like(self.mask), area)
            self.assertTrue(torch.equal(self.compose.compose(torch.ones_like(pixels), context)[0], self.original))

    def test_external_resize_is_returned_to_crop_before_composite(self):
        _, _, context = self.prepare.prepare(self.paint, self.original, self.mask, "Only masked", 0, "original", 0)
        output = self.compose.compose(torch.ones((1, 16, 24, 3)), context)[0]
        self.assertEqual(tuple(output.shape), tuple(self.original.shape))
        self.assertTrue(torch.all(output[:, 20:28, 30:38] == 1))

    def test_non_multiple_of_eight_and_tiny_images_pad_not_scale(self):
        for height, width in ((13, 17), (1, 1)):
            original = torch.rand((1, height, width, 3))
            mask = torch.ones((1, height, width))
            pixels, _, context = self.prepare.prepare(original, original, mask, mask_blur=0,
                                                       generation_size="Custom", custom_size=20 if height > 1 else 8)
            self.assertEqual(pixels.shape[1] % 8, 0)
            self.assertEqual(pixels.shape[2] % 8, 0)
            self.assertTrue(torch.equal(pixels[:, :height, :width], original))
            self.assertTrue(torch.equal(self.compose.compose(pixels, context)[0], original))

    def test_fill_changes_only_generation_image_and_retains_unpainted_original(self):
        pixels, _, context = self.prepare.prepare(self.paint, self.original, self.mask, masked_content="fill", mask_blur=0,
                                                   generation_size="Custom", custom_size=72)
        self.assertTrue(torch.allclose(pixels, self.original))
        self.assertTrue(torch.all(self.paint[:, 20:28, 30:38] == 1))
        self.assertTrue(torch.equal(context["original"], self.original))

    def test_full_mask_fill_is_finite(self):
        pixels, _, _ = self.prepare.prepare(self.paint, self.original, torch.ones_like(self.mask), masked_content="fill", mask_blur=0)
        self.assertTrue(torch.all(pixels == 0.5))

    def test_sigma_four_and_maximum_blur_do_not_change_image(self):
        mask = torch.zeros((1, 65, 65))
        mask[:, :, 32] = 1
        blurred = module.blur_mask(mask, 4)
        self.assertGreater(blurred[0, 50, 22].item(), 0)
        self.assertEqual(blurred[0, 50, 21].item(), 0)
        self.assertAlmostEqual(blurred[0, 50, 32].item(), 0.1006, places=3)
        self.assertAlmostEqual(module.blur_mask(torch.ones((1, 1, 1)), 64).item(), 1, places=5)

    def test_disconnected_masks_share_one_crop_and_batch_is_supported(self):
        mask = self.mask.repeat(2, 1, 1)
        mask[1, 40:48, 50:58] = 1
        original = self.original.repeat(2, 1, 1, 1)
        pixels, _, context = self.prepare.prepare(original, original, mask, "Only masked", 0, "original", 0)
        self.assertEqual(pixels.shape[0], 2)
        result = self.compose.compose(torch.ones_like(pixels), context)[0]
        self.assertEqual(result[1, 40, 50, 0].item(), 1)
        self.assertEqual(result[0, 40, 50, 0].item(), 0.25)

    def test_presets_and_custom_choose_pixels_not_square_shapes(self):
        for base in (512, 768, 1024, 1200):
            height, width = module.generation_dimensions(240, 360, base)
            self.assertEqual(height % 8, 0)
            self.assertEqual(width % 8, 0)
            self.assertAlmostEqual(width / height, 1.5, delta=0.02)
            self.assertAlmostEqual(width * height / (base * base), 1, delta=0.025)
        self.assertEqual(module.generation_dimensions(256, 256, 1024), (1024, 1024))
        self.assertEqual(module.generation_dimensions(256, 1024, 1024), (512, 2048))

    def test_auto_resize_keeps_image_mask_aligned_and_composite_returns_original_size(self):
        for preset in ("512×512", "768×768", "1024×1024", "Custom"):
            pixels, mask, context = self.prepare.prepare(self.paint, self.original, self.mask,
                "Only masked", 3, "original", 0, generation_size=preset, custom_size=1200)
            base = 1200 if preset == "Custom" else int(preset.split("×")[0])
            self.assertEqual(tuple(pixels.shape[1:3]), (base, base))
            self.assertEqual(tuple(mask.shape[1:3]), tuple(pixels.shape[1:3]))
            self.assertEqual(context["prepared_size"], (16, 16))
            output = self.compose.compose(torch.zeros_like(pixels), context)[0]
            expected = self.original.clone()
            expected[:, 20:28, 30:38] = 0
            self.assertTrue(torch.equal(output, expected))

    def test_schema_defaults_and_arbitrary_custom_value(self):
        fields = self.prepare.INPUT_TYPES()["required"]
        self.assertEqual(fields["generation_size"][1]["default"], "1024×1024")
        self.assertEqual(fields["custom_size"][1]["default"], 1024)
        pixels, mask, _ = self.prepare.prepare(self.paint, self.original, self.mask,
            "Only masked", 0, "original", 0, generation_size="Custom", custom_size=1000)
        self.assertEqual(tuple(pixels.shape[1:3]), (1000, 1000))
        self.assertEqual(tuple(mask.shape[1:3]), (1000, 1000))

    def test_tall_crop_and_reduction_keep_aspect_ratio_and_original_unmodified(self):
        for height, width in ((768, 256), (256, 768)):
            original = torch.full((1, height, width, 3), 0.25)
            pixels, mask, context = self.prepare.prepare(original, original, torch.ones((1,height,width)),
                "Whole picture", mask_blur=0, generation_size="512×512")
            self.assertEqual(tuple(pixels.shape[1:3]), (height, width))
            self.assertAlmostEqual(pixels.shape[2] / pixels.shape[1], width / height, delta=0.03)
            self.assertEqual(tuple(mask.shape[1:3]), tuple(pixels.shape[1:3]))
            result = self.compose.compose(torch.ones_like(pixels), context)[0]
            self.assertEqual(tuple(result.shape), tuple(original.shape))
            self.assertTrue(torch.all(result == 1))
            self.assertTrue(torch.all(original == 0.25))

    def test_whole_picture_ignores_hidden_upscale_options(self):
        for preset, custom in (("512×512",512),("1024×1024",1024),("Custom",4096)):
            pixels, mask, _ = self.prepare.prepare(self.paint,self.original,self.mask,
                "Whole picture",mask_blur=0,generation_size=preset,custom_size=custom)
            self.assertTrue(torch.equal(pixels,self.paint))
            self.assertTrue(torch.equal(mask,self.mask))


if __name__ == "__main__":
    unittest.main()
