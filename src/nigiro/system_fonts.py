"""Find system fonts and read font files for portable exports."""

from base64 import b64encode
from pathlib import Path

from fontTools.ttLib import TTFont
from matplotlib.font_manager import FontManager, FontProperties, weight_dict


class SystemFonts:
    def __init__(self) -> None:
        self.manager: FontManager | None = None

    def families(self, *, refresh: bool = False) -> list[str]:
        if self.manager is None or refresh:
            self.manager = FontManager()
        return sorted({font.name for font in self.manager.ttflist}, key=str.casefold)

    def styles(self) -> dict[str, list[str]]:
        self.families()
        faces = {}
        for font in self.manager.ttflist:
            weight = font.weight if isinstance(font.weight, int) else weight_dict.get(font.weight, 400)
            faces.setdefault(font.name, set()).add((weight, font.style))
        return {family: [f"{weight}:{style}" for weight, style in sorted(variants)]
                for family, variants in faces.items()}

    def export(self, family: str, weight: int, style: str) -> dict:
        self.families()
        properties = FontProperties(family=[family], weight=weight, style=style)
        try:
            path = Path(self.manager.findfont(properties, fallback_to_default=False))
        except ValueError as error:
            raise ValueError(f"Install {family} or clear Embed used fonts.") from error
        if path.suffix.lower() not in (".ttf", ".otf"):
            raise ValueError(f"Use a TrueType or OpenType file to embed {family}.")
        with TTFont(path) as font:
            flags = font["OS/2"].fsType if "OS/2" in font else 0
            if flags & 0x0206:
                raise ValueError(f"{family} does not allow embedding in an editable script.")
        return {
            "family": family,
            "extension": path.suffix.lower(),
            "data": b64encode(path.read_bytes()).decode("ascii"),
            "weight": str(weight),
            "style": "italic" if style == "oblique" else style,
        }
