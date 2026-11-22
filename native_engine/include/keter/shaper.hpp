#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <memory>

#include <hb.h>
#include <hb-ft.h>
#include <ft2build.h>
#include FT_FREETYPE_H

namespace keter {

struct ShapedGlyph {
    uint32_t glyph_id{0};
    uint32_t cluster{0};
    double x_advance{0.0};
    double y_advance{0.0};
    double x_offset{0.0};
    double y_offset{0.0};
    bool is_mark{false};
    char32_t original_codepoint{0};
};

struct ShapedRun {
    std::string text_utf8;
    std::vector<ShapedGlyph> glyphs;
    double total_advance{0.0};
    double font_size_pt{12.0};
    bool is_rtl{true};
    std::string font_family;
};

class HarfBuzzShaper {
public:
    HarfBuzzShaper();
    ~HarfBuzzShaper();

    bool loadFont(const std::string& font_path, double point_size);
    bool setFontSize(double point_size);

    ShapedRun shapeText(
        const std::string& utf8_text,
        hb_direction_t direction = HB_DIRECTION_RTL,
        hb_script_t script = HB_SCRIPT_HEBREW,
        const char* language = "he"
    );

    // Font metrics in typographic points
    double getAscent() const;
    double getDescent() const;
    double getLineHeight() const;

private:
    FT_Library ft_library_{nullptr};
    FT_Face ft_face_{nullptr};
    hb_font_t* hb_font_{nullptr};
    double current_point_size_{12.0};
    void cleanup();
};

} // namespace keter
