#include "../../include/keter/font_manager.hpp"
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_OPENTYPE_VALIDATE_H
#include <iostream>
#include <filesystem>

namespace keter {

FontManager::FontManager() = default;
FontManager::~FontManager() = default;

FontCapabilities FontManager::inspectFont(const std::string& font_path) {
    FontCapabilities cap;
    cap.file_path = font_path;

    FT_Library ft;
    if (FT_Init_FreeType(&ft)) return cap;

    FT_Face face;
    if (FT_New_Face(ft, font_path.c_str(), 0, &face)) {
        FT_Done_FreeType(ft);
        return cap;
    }

    cap.family_name = face->family_name ? face->family_name : "Unknown";
    cap.postscript_name = FT_Get_Postscript_Name(face) ? FT_Get_Postscript_Name(face) : "";

    // 1. Check basic Hebrew letters: Alef (0x05D0) to Tav (0x05EA)
    int letters_found = 0;
    for (char32_t cp = 0x05D0; cp <= 0x05EA; ++cp) {
        if (FT_Get_Char_Index(face, cp) != 0) letters_found++;
    }
    cap.has_hebrew_script = (letters_found >= 22);

    // 2. Check Nikud vowels: Sheva (0x05B0) to Kubutz (0x05BB)
    int nikud_found = 0;
    for (char32_t cp = 0x05B0; cp <= 0x05BB; ++cp) {
        if (FT_Get_Char_Index(face, cp) != 0) nikud_found++;
    }
    cap.has_nikud_support = (nikud_found >= 10);

    // 3. Check Taamim (cantillation): 0x0591 to 0x05AF
    int taamim_found = 0;
    for (char32_t cp = 0x0591; cp <= 0x05AF; ++cp) {
        if (FT_Get_Char_Index(face, cp) != 0) taamim_found++;
    }
    cap.has_taamim_support = (taamim_found >= 15);

    // 4. Calculate holy-book suitability score
    int score = 0;
    if (cap.has_hebrew_script) score += 40;
    if (cap.has_nikud_support) score += 30;
    if (cap.has_taamim_support) score += 30;

    // Check for standard high-grade holy-book typefaces
    std::string name_lower = cap.family_name;
    for (auto& c : name_lower) c = static_cast<char>(std::tolower(c));

    if (name_lower.find("frank") != std::string::npos || 
        name_lower.find("ruhl") != std::string::npos ||
        name_lower.find("vilna") != std::string::npos ||
        name_lower.find("keter") != std::string::npos ||
        name_lower.find("cardo") != std::string::npos ||
        name_lower.find("hadassah") != std::string::npos) {
        score = std::min(100, score + 10);
    }

    cap.holy_book_suitability_score = score;
    if (score >= 90) {
        cap.recommendation_notes = "Excellent for Jewish holy books (Full Taamim, Nikud, and glyph coverage)";
    } else if (score >= 70) {
        cap.recommendation_notes = "Suitable for Gemara / Commentary with Nikud, lacks full biblical Taamim";
    } else if (score >= 40) {
        cap.recommendation_notes = "Hebrew text only (consonants). Not recommended for vocalized holy texts.";
    } else {
        cap.recommendation_notes = "Unsupported / Missing Hebrew Unicode range.";
    }

    FT_Done_Face(face);
    FT_Done_FreeType(ft);
    return cap;
}

std::vector<FontCapabilities> FontManager::enumerateSystemFonts() {
    std::vector<FontCapabilities> results;
    // Standard font search locations
    std::vector<std::string> search_dirs = {
#if defined(_WIN32)
        "C:\\Windows\\Fonts",
#elif defined(__APPLE__)
        "/Library/Fonts",
        "/System/Library/Fonts",
#else
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        "~/.local/share/fonts"
#endif
    };

    for (const auto& dir : search_dirs) {
        if (!std::filesystem::exists(dir)) continue;
        for (const auto& entry : std::filesystem::recursive_directory_iterator(dir)) {
            if (entry.is_regular_file()) {
                std::string ext = entry.path().extension().string();
                if (ext == ".ttf" || ext == ".otf" || ext == ".ttc") {
                    auto cap = inspectFont(entry.path().string());
                    if (cap.has_hebrew_script) {
                        results.push_back(cap);
                    }
                }
            }
        }
    }
    return results;
}

std::string FontManager::selectBestFont(const std::string& category, bool require_taamim) {
    // Returns recommended font family based on holy-book category
    if (category == "Tanach" || require_taamim) {
        return "Taamey Frank CLM / Keter Aram Tzova";
    }
    if (category == "Rashi") {
        return "Rashi Script CLM / Veda Rashi";
    }
    if (category == "Gemara") {
        return "Vilna / Frank Ruehl";
    }
    return "Frank Ruhl Libre";
}

std::vector<char32_t> FontManager::checkMissingGlyphs(const std::string& font_path, const std::string& utf8_text) {
    std::vector<char32_t> missing;
    FT_Library ft;
    if (FT_Init_FreeType(&ft)) return missing;

    FT_Face face;
    if (FT_New_Face(ft, font_path.c_str(), 0, &face)) {
        FT_Done_FreeType(ft);
        return missing;
    }

    size_t i = 0;
    while (i < utf8_text.size()) {
        unsigned char c = static_cast<unsigned char>(utf8_text[i]);
        char32_t cp = 0;
        size_t len = 1;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c & 0xE0) == 0xC0) {
            cp = ((c & 0x1F) << 6) | (utf8_text[i+1] & 0x3F);
            len = 2;
        } else if ((c & 0xF0) == 0xE0) {
            cp = ((c & 0x0F) << 12) | ((utf8_text[i+1] & 0x3F) << 6) | (utf8_text[i+2] & 0x3F);
            len = 3;
        } else {
            len = 4;
        }

        if (cp > 0x20 && FT_Get_Char_Index(face, cp) == 0) {
            missing.push_back(cp);
        }
        i += len;
    }

    FT_Done_Face(face);
    FT_Done_FreeType(ft);
    return missing;
}

} // namespace keter
