"""Find system fonts and read font files for portable exports."""

from base64 import b64encode
from pathlib import Path

from fontTools.ttLib import TTFont
from matplotlib.font_manager import FontManager, FontProperties


class SystemFonts:
    def __init__(self) -> None:
        self.manager: FontManager | None = None

    def families(self, *, refresh: bool = False) -> list[str]:
        if self.manager is None or refresh:
            self.manager = FontManager()
        return sorted({font.name for font in self.manager.ttflist}, key=str.casefold)

    def export(self, family: str, bold: bool, italic: bool) -> dict:
        self.families()
        properties = FontProperties(family=[family], weight="bold" if bold else "normal",
                                    style="italic" if italic else "normal")
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
            "weight": "bold" if bold else "normal",
            "style": "italic" if italic else "normal",
        }
