"""Measurement conversion and saved style compatibility."""

import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path

from nigiro.figure_style import AxisStyle, FigureStyle
from nigiro.settings import Settings
from nigiro.storage import OPERATION_TYPES, operation_record
from nigiro.project import FigureAppearance


class MeasurementTest(unittest.TestCase):
    def test_lengths_convert_to_pixels_and_preserve_units(self):
        for text, pixels, unit in (
            ("96", 96, "px"), ("72 pt", 96, "pt"), ("2.54 cm", 96, "cm"),
            ("25.4mm", 96, "mm"), ("1 IN", 96, "in"), ("6 pc", 96, "pc"),
            ("101.6 q", 96, "q"), ("1e2 px", 100, "px"),
        ):
            with self.subTest(text=text):
                style = FigureStyle(axes_width=text)
                self.assertAlmostEqual(style.axes_width, pixels)
                self.assertEqual(style.units["axes_width"], unit)
                self.assertEqual(FigureStyle(**asdict(style)), style)

    def test_axis_units_and_old_numeric_styles(self):
        axis = AxisStyle(tick_length="3 pt", line_width="0.25 mm", angle="0.25 turn")
        self.assertEqual(axis.tick_length, 4)
        self.assertAlmostEqual(axis.line_width, 96 / 101.6)
        self.assertEqual(axis.angle, 90)
        self.assertEqual(AxisStyle(**asdict(axis)), axis)
        self.assertEqual(FigureStyle(axes_width=420).axes_width, 420)
        self.assertAlmostEqual(FigureStyle(axes_width="8 cm").axes_width, 8 * 96 / 2.54)
        legacy = FigureStyle(residual={"zero_line": True})
        self.assertNotIn("residual", asdict(legacy))

    def test_settings_and_recorded_styles_keep_units(self):
        style = FigureStyle(axes_width="8 cm", label_size="9 pt", y={"tick_length": "1 mm"})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            Settings(path).save(style)
            self.assertEqual(Settings(path).figure_style, style)
        record = operation_record(FigureAppearance(0, style))
        operation = OPERATION_TYPES[record.pop("kind")](**record)
        self.assertEqual(operation.style, style)

    def test_invalid_units_are_rejected(self):
        for value in ("8 em", "nan px", "inf cm", "12 px extra", "1/2 in"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                FigureStyle(axes_width=value)
        with self.assertRaises(ValueError):
            AxisStyle(units={"angle": "cm"})
