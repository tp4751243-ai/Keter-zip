#include "../../include/keter/typography_engine.hpp"
#include <iostream>
#include <vector>
#include <cstring>
#include <stdexcept>

namespace keter {

TypographyEngine::TypographyEngine() {
    initialize();
}

TypographyEngine::~TypographyEngine() {
    cleanup();
    if (ft_library_) {
        FT_Done_FreeType(ft_library_);
        ft_library_ = nullptr;
    }
}

bool TypographyEngine::initialize() {
    if (!ft_library_) {
        if (FT_Init_FreeType(&ft_library_)) {
            std::cerr << "[TypographyEngine] Failed to initialize FreeType 2\n";
            return false;
        }
    }

    UErrorCode status = U_ZERO_ERROR;
    nfc_normalizer_ = unorm2_getNFCInstance(&status);
    if (U_FAILURE(status)) {
        std::cerr << "[TypographyEngine] Failed to initialize ICU NFC Normalizer: " << u_errorName(status) << "\n";
    }

    status = U_ZERO_ERROR;
    nfd_normalizer_ = unorm2_getNFDInstance(&status);
    if (U_FAILURE(status)) {
        std::cerr << "[TypographyEngine] Failed to initialize ICU NFD Normalizer: " << u_errorName(status) << "\n";
    }

    return true;
}

void TypographyEngine::cleanup() {
    if (hb_font_) {
        hb_font_destroy(hb_font_);
        hb_font_ = nullptr;
    }
    if (ft_face_) {
        FT_Done_Face(ft_face_);
        ft_face_ = nullptr;
    }
}

bool TypographyEngine::loadFontFace(const std::string& font_path, double point_size_pt, int face_index) {
    cleanup();
    point_size_pt_ = point_size_pt;

    if (!ft_library_) {
        if (!initialize()) return false;
    }

    if (FT_New_Face(ft_library_, font_path.c_str(), face_index, &ft_face_)) {
        std::cerr << "[TypographyEngine] Failed to load font face from: " << font_path << "\n";
        return false;
    }

    // Standard 72 DPI for Desktop publishing (1 pt = 1/72 inch = 1 pixel at 72 dpi)
    FT_Set_Char_Size(ft_face_, 0, static_cast<FT_F26Dot6>(point_size_pt_ * 64), 72, 72);

    hb_font_ = hb_ft_font_create(ft_face_, nullptr);
    if (!hb_font_) {
        std::cerr << "[TypographyEngine] Failed to create HarfBuzz font wrapper\n";
        return false;
    }

    return true;
}

void TypographyEngine::setPointSize(double point_size_pt) {
    point_size_pt_ = point_size_pt;
    if (ft_face_) {
        FT_Set_Char_Size(ft_face_, 0, static_cast<FT_F26Dot6>(point_size_pt_ * 64), 72, 72);
        if (hb_font_) {
            hb_ft_font_changed(hb_font_);
        }
    }
}

std::vector<BidiRun> TypographyEngine::analyzeBidi(const std::string& utf8_text, UBiDiLevel default_level) {
    std::vector<BidiRun> runs;
    if (utf8_text.empty()) return runs;

    UErrorCode status = U_ZERO_ERROR;
    UBiDi* bidi = ubidi_openSized(static_cast<int32_t>(utf8_text.size()), 0, &status);
    if (U_FAILURE(status) || !bidi) {
        // Fallback: single RTL run
        runs.push_back({0, static_cast<int32_t>(utf8_text.size()), default_level});
        return runs;
    }

    // Convert UTF-8 to UTF-16 for ICU BiDi
    std::vector<UChar> utf16_buf(utf8_text.size() + 1);
    int32_t utf16_len = 0;
    u_strFromUTF8(utf16_buf.data(), static_cast<int32_t>(utf16_buf.size()), &utf16_len, utf8_text.c_str(), -1, &status);

    if (U_FAILURE(status)) {
        ubidi_close(bidi);
        runs.push_back({0, static_cast<int32_t>(utf8_text.size()), default_level});
        return runs;
    }

    ubidi_setPara(bidi, utf16_buf.data(), utf16_len, default_level, nullptr, &status);
    if (U_FAILURE(status)) {
        ubidi_close(bidi);
        runs.push_back({0, static_cast<int32_t>(utf8_text.size()), default_level});
        return runs;
    }

    int32_t run_count = ubidi_countRuns(bidi, &status);
    for (int32_t i = 0; i < run_count; ++i) {
        int32_t logical_start = 0;
        int32_t length = 0;
        UBiDiLevel level = 0;
        ubidi_getVisualRun(bidi, i, &logical_start, &length);
        level = ubidi_getLevelAt(bidi, logical_start);

        runs.push_back({logical_start, length, level});
    }

    ubidi_close(bidi);
    return runs;
}

std::string TypographyEngine::normalizeNFC(const std::string& utf8_text) {
    if (!nfc_normalizer_ || utf8_text.empty()) return utf8_text;
    UErrorCode status = U_ZERO_ERROR;

    std::vector<UChar> src(utf8_text.size() + 1);
    int32_t src_len = 0;
    u_strFromUTF8(src.data(), static_cast<int32_t>(src.size()), &src_len, utf8_text.c_str(), -1, &status);
    if (U_FAILURE(status)) return utf8_text;

    std::vector<UChar> dest(src_len * 2 + 1);
    int32_t dest_len = unorm2_normalize(nfc_normalizer_, src.data(), src_len, dest.data(), static_cast<int32_t>(dest.size()), &status);
    if (U_FAILURE(status)) return utf8_text;

    std::vector<char> utf8_dest(dest_len * 4 + 1);
    int32_t final_len = 0;
    u_strToUTF8(utf8_dest.data(), static_cast<int32_t>(utf8_dest.size()), &final_len, dest.data(), dest_len, &status);
    if (U_FAILURE(status)) return utf8_text;

    return std::string(utf8_dest.data(), final_len);
}

std::string TypographyEngine::normalizeNFD(const std::string& utf8_text) {
    if (!nfd_normalizer_ || utf8_text.empty()) return utf8_text;
    UErrorCode status = U_ZERO_ERROR;

    std::vector<UChar> src(utf8_text.size() + 1);
    int32_t src_len = 0;
    u_strFromUTF8(src.data(), static_cast<int32_t>(src.size()), &src_len, utf8_text.c_str(), -1, &status);
    if (U_FAILURE(status)) return utf8_text;

    std::vector<UChar> dest(src_len * 3 + 1);
    int32_t dest_len = unorm2_normalize(nfd_normalizer_, src.data(), src_len, dest.data(), static_cast<int32_t>(dest.size()), &status);
    if (U_FAILURE(status)) return utf8_text;

    std::vector<char> utf8_dest(dest_len * 4 + 1);
    int32_t final_len = 0;
    u_strToUTF8(utf8_dest.data(), static_cast<int32_t>(utf8_dest.size()), &final_len, dest.data(), dest_len, &status);
    if (U_FAILURE(status)) return utf8_text;

    return std::string(utf8_dest.data(), final_len);
}

std::vector<GlyphMetrics> TypographyEngine::shapeRun(
    const std::string& utf8_run,
    bool is_rtl,
    const std::string& language,
    const OpenTypeFeatures& features
) {
    std::vector<GlyphMetrics> result;
    if (utf8_run.empty() || !hb_font_) return result;

    hb_buffer_t* buffer = hb_buffer_create();
    hb_buffer_add_utf8(buffer, utf8_run.c_str(), static_cast<int>(utf8_run.size()), 0, -1);
    hb_buffer_set_direction(buffer, is_rtl ? HB_DIRECTION_RTL : HB_DIRECTION_LTR);
    hb_buffer_set_script(buffer, is_rtl ? HB_SCRIPT_HEBREW : HB_SCRIPT_LATIN);
    hb_buffer_set_language(buffer, hb_language_from_string(language.c_str(), -1));

    // Configure OpenType features for Jewish holy-book typography
    std::vector<hb_feature_t> hb_features;
    hb_feature_t feat;
    if (features.kerning) {
        hb_feature_from_string("kern=1", -1, &feat);
        hb_features.push_back(feat);
    }
    if (features.mark_to_base) {
        hb_feature_from_string("mark=1", -1, &feat);
        hb_features.push_back(feat);
    }
    if (features.mark_to_mark) {
        hb_feature_from_string("mkmk=1", -1, &feat);
        hb_features.push_back(feat);
    }
    if (features.discretionary_ligatures) {
        hb_feature_from_string("dlig=1", -1, &feat);
        hb_features.push_back(feat);
    }
    if (features.contextual_alternates) {
        hb_feature_from_string("calt=1", -1, &feat);
        hb_features.push_back(feat);
    }

    hb_shape(hb_font_, buffer, hb_features.data(), static_cast<unsigned int>(hb_features.size()));

    unsigned int glyph_count = 0;
    hb_glyph_info_t* glyph_info = hb_buffer_get_glyph_infos(buffer, &glyph_count);
    hb_glyph_position_t* glyph_pos = hb_buffer_get_glyph_positions(buffer, &glyph_count);

    const double scale = 1.0 / 64.0;
    result.reserve(glyph_count);

    for (unsigned int i = 0; i < glyph_count; ++i) {
        GlyphMetrics gm;
        gm.glyph_index = glyph_info[i].codepoint;
        gm.cluster = glyph_info[i].cluster;
        gm.x_advance = glyph_pos[i].x_advance * scale;
        gm.y_advance = glyph_pos[i].y_advance * scale;
        gm.x_offset = glyph_pos[i].x_offset * scale;
        gm.y_offset = glyph_pos[i].y_offset * scale;

        // Load FreeType glyph slot for bounding box and bearing metrics
        if (ft_face_ && !FT_Load_Glyph(ft_face_, gm.glyph_index, FT_LOAD_DEFAULT)) {
            gm.width = ft_face_->glyph->metrics.width * scale;
            gm.height = ft_face_->glyph->metrics.height * scale;
            gm.bearing_x = ft_face_->glyph->metrics.horiBearingX * scale;
            gm.bearing_y = ft_face_->glyph->metrics.horiBearingY * scale;
        }

        gm.is_mark = (gm.x_advance == 0.0 && (gm.x_offset != 0.0 || gm.y_offset != 0.0));
        result.push_back(gm);
    }

    hb_buffer_destroy(buffer);
    return result;
}

double TypographyEngine::getAscent() const {
    if (!ft_face_) return point_size_pt_ * 0.82;
    return (ft_face_->size->metrics.ascender / 64.0);
}

double TypographyEngine::getDescent() const {
    if (!ft_face_) return point_size_pt_ * 0.22;
    return -(ft_face_->size->metrics.descender / 64.0);
}

double TypographyEngine::getCapHeight() const {
    if (!ft_face_) return point_size_pt_ * 0.70;
    // Inspect letter Alef (0x05D0) or Latin 'H'
    FT_UInt index = FT_Get_Char_Index(ft_face_, 0x05D0);
    if (index && !FT_Load_Glyph(ft_face_, index, FT_LOAD_DEFAULT)) {
        return ft_face_->glyph->metrics.height / 64.0;
    }
    return point_size_pt_ * 0.70;
}

double TypographyEngine::getXHeight() const {
    if (!ft_face_) return point_size_pt_ * 0.48;
    FT_UInt index = FT_Get_Char_Index(ft_face_, 0x05DE); // Mem
    if (index && !FT_Load_Glyph(ft_face_, index, FT_LOAD_DEFAULT)) {
        return ft_face_->glyph->metrics.height / 64.0;
    }
    return point_size_pt_ * 0.48;
}

double TypographyEngine::getLineHeight() const {
    if (!ft_face_) return point_size_pt_ * 1.30;
    return (ft_face_->size->metrics.height / 64.0);
}

double TypographyEngine::getUnderlinePosition() const {
    if (!ft_face_) return -point_size_pt_ * 0.15;
    return (ft_face_->underline_position / 64.0);
}

double TypographyEngine::getUnderlineThickness() const {
    if (!ft_face_) return point_size_pt_ * 0.05;
    return (ft_face_->underline_thickness / 64.0);
}

double TypographyEngine::getKerning(uint32_t left_glyph, uint32_t right_glyph) const {
    if (!ft_face_ || !FT_HAS_KERNING(ft_face_)) return 0.0;
    FT_Vector kerning;
    if (FT_Get_Kerning(ft_face_, left_glyph, right_glyph, FT_KERNING_DEFAULT, &kerning)) {
        return 0.0;
    }
    return kerning.x / 64.0;
}

} // namespace keter
