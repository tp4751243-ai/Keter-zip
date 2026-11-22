#pragma once

#include <string>
#include <vector>
#include <cstdint>

namespace keter {

struct FontCapabilities {
    std::string family_name;
    std::string postscript_name;
    std::string file_path;
    bool has_hebrew_script{false};
    bool has_nikud_support{false};
    bool has_taamim_support{false};
    bool has_gpos_mark{false};
    bool has_gpos_mkmk{false};
    bool has_gsub_ligatures{false}; // e.g. Alef-Lamed ligature
    int holy_book_suitability_score{0}; // 0 - 100
    std::string recommendation_notes;
};

class FontManager {
public:
    FontManager();
    ~FontManager();

    std::vector<FontCapabilities> enumerateSystemFonts();
    FontCapabilities inspectFont(const std::string& font_path);
    
    // Selects the optimal font matching target holy-book style (Tanach, Gemara, Rashi, Commentary)
    std::string selectBestFont(const std::string& category, bool require_taamim);

    // Verify missing glyphs for a specific text
    std::vector<char32_t> checkMissingGlyphs(const std::string& font_path, const std::string& utf8_text);
};

} // namespace keter
