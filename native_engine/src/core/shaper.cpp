#include "../../include/keter/shaper.hpp"
#include <iostream>
#include <stdexcept>

namespace keter {

HarfBuzzShaper::HarfBuzzShaper() {
    if (FT_Init_FreeType(&ft_library_)) {
        std::cerr << "Failed to initialize FreeType library\n";
    }
}

HarfBuzzShaper::~HarfBuzzShaper() {
    cleanup();
    if (ft_library_) {
        FT_Done_FreeType(ft_library_);
        ft_library_ = nullptr;
    }
}

void HarfBuzzShaper::cleanup() {
    if (hb_font_) {
        hb_font_destroy(hb_font_);
        hb_font_ = nullptr;
    }
    if (ft_face_) {
        FT_Done_Face(ft_face_);
        ft_face_ = nullptr;
    }
}

bool HarfBuzzShaper::loadFont(const std::string& font_path, double point_size) {
    cleanup();
    current_point_size_ = point_size;

    if (!ft_library_) return false;

    if (FT_New_Face(ft_library_, font_path.c_str(), 0, &ft_face_)) {
        std::cerr << "Failed to load font face from: " << font_path << "\n";
        return false;
    }

    // Set char size: 72 DPI base
    FT_Set_Char_Size(ft_face_, 0, static_cast<FT_F26Dot6>(point_size * 64), 72, 72);

    // Create HarfBuzz font from FreeType face
    hb_font_ = hb_ft_font_create(ft_face_, nullptr);
    if (!hb_font_) {
        std::cerr << "Failed to create HarfBuzz font wrapper\n";
        return false;
    }

    return true;
}

bool HarfBuzzShaper::setFontSize(double point_size) {
    if (!ft_face_ || !hb_font_) return false;
    current_point_size_ = point_size;
    FT_Set_Char_Size(ft_face_, 0, static_cast<FT_F26Dot6>(point_size * 64), 72, 72);
    hb_ft_font_changed(hb_font_);
    return true;
}

ShapedRun HarfBuzzShaper::shapeText(
    const std::string& utf8_text,
    hb_direction_t direction,
    hb_script_t script,
    const char* language
) {
    ShapedRun run;
    run.text_utf8 = utf8_text;
    run.font_size_pt = current_point_size_;
    run.is_rtl = (direction == HB_DIRECTION_RTL);

    if (!hb_font_) {
        return run;
    }

    hb_buffer_t* buffer = hb_buffer_create();
    hb_buffer_add_utf8(buffer, utf8_text.c_str(), static_cast<int>(utf8_text.size()), 0, -1);
    hb_buffer_set_direction(buffer, direction);
    hb_buffer_set_script(buffer, script);
    hb_buffer_set_language(buffer, hb_language_from_string(language, -1));

    // Enable crucial OpenType features for Jewish holy-book typography:
    // 'kern': Kerning
    // 'mark': Mark-to-base positioning (Nikud)
    // 'mkmk': Mark-to-mark positioning (Nikud + Taamim stacking)
    // 'dlig': Discretionary ligatures (e.g. Alef-Lamed)
    hb_feature_t features[4];
    hb_feature_from_string("kern=1", -1, &features[0]);
    hb_feature_from_string("mark=1", -1, &features[1]);
    hb_feature_from_string("mkmk=1", -1, &features[2]);
    hb_feature_from_string("dlig=1", -1, &features[3]);

    hb_shape(hb_font_, buffer, features, 4);

    unsigned int glyph_count = 0;
    hb_glyph_info_t* glyph_info = hb_buffer_get_glyph_infos(buffer, &glyph_count);
    hb_glyph_position_t* glyph_pos = hb_buffer_get_glyph_positions(buffer, &glyph_count);

    // Scaling factor from 26.6 fixed point or font units to points
    // HarfBuzz FreeType integration defaults to 26.6 scale (64 units per point at 72 dpi)
    const double scale = 1.0 / 64.0;

    run.glyphs.reserve(glyph_count);
    double total_adv = 0.0;

    for (unsigned int i = 0; i < glyph_count; ++i) {
        ShapedGlyph g;
        g.glyph_id = glyph_info[i].codepoint;
        g.cluster = glyph_info[i].cluster;
        g.x_advance = glyph_pos[i].x_advance * scale;
        g.y_advance = glyph_pos[i].y_advance * scale;
        g.x_offset = glyph_pos[i].x_offset * scale;
        g.y_offset = glyph_pos[i].y_offset * scale;
        g.is_mark = (glyph_pos[i].x_advance == 0 && (glyph_pos[i].x_offset != 0 || glyph_pos[i].y_offset != 0));

        total_adv += g.x_advance;
        run.glyphs.push_back(g);
    }

    run.total_advance = total_adv;
    hb_buffer_destroy(buffer);
    return run;
}

double HarfBuzzShaper::getAscent() const {
    if (!ft_face_) return current_point_size_ * 0.8;
    return (ft_face_->size->metrics.ascender / 64.0);
}

double HarfBuzzShaper::getDescent() const {
    if (!ft_face_) return current_point_size_ * 0.2;
    return -(ft_face_->size->metrics.descender / 64.0);
}

double HarfBuzzShaper::getLineHeight() const {
    if (!ft_face_) return current_point_size_ * 1.25;
    return (ft_face_->size->metrics.height / 64.0);
}

} // namespace keter
