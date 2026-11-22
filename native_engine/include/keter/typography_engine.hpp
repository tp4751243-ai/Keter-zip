#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <memory>

#include <unicode/ubidi.h>
#include <unicode/uchar.h>
#include <unicode/unorm2.h>
#include <unicode/ustring.h>

#include <hb.h>
#include <hb-ft.h>
#include <ft2build.h>
#include FT_FREETYPE_H

namespace keter {

enum class Direction {
    RTL,
    LTR,
    Mixed
};

struct BidiRun {
    int32_t start_index{0};
    int32_t length{0};
    UBiDiLevel level{0}; // Odd = RTL, Even = LTR
    bool is_rtl() const { return (level % 2) != 0; }
};

struct GlyphMetrics {
    uint32_t glyph_index{0};
    char32_t codepoint{0};
    double x_advance{0.0};
    double y_advance{0.0};
    double x_offset{0.0};
    double y_offset{0.0};
    double width{0.0};
    double height{0.0};
    double bearing_x{0.0};
    double bearing_y{0.0};
    bool is_mark{false};
    bool is_taam{false};
    uint32_t cluster{0};
};

struct OpenTypeFeatures {
    bool kerning{true};              // 'kern'
    bool mark_to_base{true};          // 'mark'
    bool mark_to_mark{true};          // 'mkmk'
    bool discretionary_ligatures{true};// 'dlig' (e.g. Alef-Lamed)
    bool contextual_alternates{true}; // 'calt'
    bool historical_ligatures{false}; // 'hlig'
};

class TypographyEngine {
public:
    TypographyEngine();
    ~TypographyEngine();

    bool initialize();
    bool loadFontFace(const std::string& font_path, double point_size_pt, int face_index = 0);
    void setPointSize(double point_size_pt);
    double getPointSize() const { return point_size_pt_; }

    // ICU Bidirectional Text Analysis (UAX #9)
    std::vector<BidiRun> analyzeBidi(const std::string& utf8_text, UBiDiLevel default_level = UBIDI_RTL);

    // Unicode Normalization (NFC/NFD) via ICU
    std::string normalizeNFC(const std::string& utf8_text);
    std::string normalizeNFD(const std::string& utf8_text);

    // HarfBuzz Glyph Shaping with OpenType features
    std::vector<GlyphMetrics> shapeRun(
        const std::string& utf8_run,
        bool is_rtl,
        const std::string& language = "he",
        const OpenTypeFeatures& features = OpenTypeFeatures{}
    );

    // Font Metrics (in typographic points)
    double getAscent() const;
    double getDescent() const;
    double getCapHeight() const;
    double getXHeight() const;
    double getLineHeight() const;
    double getUnderlinePosition() const;
    double getUnderlineThickness() const;

    // Kerning between two specific glyphs
    double getKerning(uint32_t left_glyph, uint32_t right_glyph) const;

private:
    FT_Library ft_library_{nullptr};
    FT_Face ft_face_{nullptr};
    hb_font_t* hb_font_{nullptr};
    double point_size_pt_{14.0};
    const UNormalizer2* nfc_normalizer_{nullptr};
    const UNormalizer2* nfd_normalizer_{nullptr};

    void cleanup();
};

} // namespace keter
