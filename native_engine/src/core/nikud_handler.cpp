#include "../../include/keter/nikud_handler.hpp"
#include <unordered_map>
#include <algorithm>

namespace keter {

bool NikudHandler::isHebrew(char32_t cp) {
    return (cp >= 0x0590 && cp <= 0x05FF) || (cp >= 0xFB1D && cp <= 0xFB4F);
}

bool NikudHandler::isNikud(char32_t cp) {
    return (cp >= 0x05B0 && cp <= 0x05BB) || cp == 0x05C7;
}

bool NikudHandler::isTaam(char32_t cp) {
    return (cp >= 0x0591 && cp <= 0x05AF);
}

bool NikudHandler::isDageshOrDot(char32_t cp) {
    return cp == 0x05BC || cp == 0x05C1 || cp == 0x05C2;
}

HebrewCharType NikudHandler::classify(char32_t cp) {
    if (cp >= 0x0591 && cp <= 0x05AF) return HebrewCharType::TaamCantillation;
    if (cp >= 0x05B0 && cp <= 0x05BB) return HebrewCharType::NikudVowel;
    if (cp == 0x05BC) return HebrewCharType::DageshOrMapiq;
    if (cp == 0x05C1 || cp == 0x05C2) return HebrewCharType::ShinSinDot;
    if (cp == 0x05BF) return HebrewCharType::Rafe;
    if (cp == 0x05C7) return HebrewCharType::NikudVowel; // Kamatz Katan
    if (cp >= 0x05D0 && cp <= 0x05EA) return HebrewCharType::BaseLetter;
    if (cp == 0x05BE || cp == 0x05C0 || cp == 0x05C3 || cp == 0x05C6) return HebrewCharType::Punctuation;
    return HebrewCharType::Other;
}

HebrewCharInfo NikudHandler::getInfo(char32_t cp) {
    HebrewCharType type = classify(cp);
    switch (cp) {
        case 0x05B0: return {cp, type, "Sheva", "שְׁוָא", true};
        case 0x05B1: return {cp, type, "Hataf Segol", "חֲטַף סֶגּוֹל", true};
        case 0x05B2: return {cp, type, "Hataf Patach", "חֲטַף פַּתַח", true};
        case 0x05B3: return {cp, type, "Hataf Kamatz", "חֲטַף קָמַץ", true};
        case 0x05B4: return {cp, type, "Hirik", "חִירִיק", true};
        case 0x05B5: return {cp, type, "Tzere", "צֵירֵי", true};
        case 0x05B6: return {cp, type, "Segol", "סֶגּוֹל", true};
        case 0x05B7: return {cp, type, "Patach", "פַּתַח", true};
        case 0x05B8: return {cp, type, "Kamatz", "קָמַץ", true};
        case 0x05B9: return {cp, type, "Holam", "חוֹלָם", true};
        case 0x05BB: return {cp, type, "Kubutz", "קֻבּוּץ", true};
        case 0x05BC: return {cp, type, "Dagesh / Mapiq", "דָּגֵשׁ / מַפִּיק", true};
        case 0x05C1: return {cp, type, "Shin Dot", "שִׁין יְמָנִית", true};
        case 0x05C2: return {cp, type, "Sin Dot", "שִׂין שְׂמָאלִית", true};
        case 0x0591: return {cp, type, "Etnahta", "אֶתְנַחְתָּא", true};
        case 0x0596: return {cp, type, "Tipcha", "טִפְחָא", true};
        case 0x05A5: return {cp, type, "Mercha", "מֵרְכָא", true};
        case 0x05A8: return {cp, type, "Pashta", "פַּשְׁטָא", true};
        case 0x05C3: return {cp, type, "Sof Pasuk", "סוֹף פָּסוּק", false};
        default: break;
    }
    return {cp, type, "Hebrew Character", "תו עברי", (type != HebrewCharType::BaseLetter && type != HebrewCharType::Punctuation)};
}

static int getMarkPrecedence(char32_t cp) {
    if (cp == 0x05BC) return 1;             // Dagesh
    if (cp == 0x05C1 || cp == 0x05C2) return 2; // Shin/Sin dot
    if (cp >= 0x05B0 && cp <= 0x05BB) return 3; // Vowels
    if (cp == 0x05C7) return 3;             // Kamatz Katan
    if (cp == 0x05BF) return 4;             // Rafe
    if (cp >= 0x0591 && cp <= 0x05AF) return 5; // Taamim
    return 6;
}

std::string NikudHandler::canonicalReorder(const std::string& utf8_input) {
    // Reorders combining marks according to canonical typesetting order
    std::string result;
    result.reserve(utf8_input.size());

    // Simple UTF-8 decoder & reorder logic
    size_t i = 0;
    while (i < utf8_input.size()) {
        unsigned char c = static_cast<unsigned char>(utf8_input[i]);
        char32_t cp = 0;
        size_t len = 1;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c & 0xE0) == 0xC0) {
            cp = ((c & 0x1F) << 6) | (utf8_input[i+1] & 0x3F);
            len = 2;
        } else if ((c & 0xF0) == 0xE0) {
            cp = ((c & 0x0F) << 12) | ((utf8_input[i+1] & 0x3F) << 6) | (utf8_input[i+2] & 0x3F);
            len = 3;
        } else {
            len = 4;
        }

        if (classify(cp) == HebrewCharType::BaseLetter) {
            result.append(utf8_input, i, len);
            i += len;

            // Collect all following combining marks
            std::vector<std::pair<char32_t, std::string>> marks;
            while (i < utf8_input.size()) {
                unsigned char mc = static_cast<unsigned char>(utf8_input[i]);
                char32_t mcp = 0;
                size_t mlen = 1;
                if ((mc & 0xE0) == 0xC0) {
                    mcp = ((mc & 0x1F) << 6) | (utf8_input[i+1] & 0x3F);
                    mlen = 2;
                } else if ((mc & 0xF0) == 0xE0) {
                    mcp = ((mc & 0x0F) << 12) | ((utf8_input[i+1] & 0x3F) << 6) | (utf8_input[i+2] & 0x3F);
                    mlen = 3;
                } else {
                    break;
                }

                if (isNikud(mcp) || isTaam(mcp) || isDageshOrDot(mcp) || mcp == 0x05BF) {
                    marks.push_back({mcp, utf8_input.substr(i, mlen)});
                    i += mlen;
                } else {
                    break;
                }
            }

            // Sort marks stably by canonical precedence
            std::stable_sort(marks.begin(), marks.end(), [](const auto& a, const auto& b) {
                return getMarkPrecedence(a.first) < getMarkPrecedence(b.first);
            });

            for (const auto& m : marks) {
                result.append(m.second);
            }
        } else {
            result.append(utf8_input, i, len);
            i += len;
        }
    }
    return result;
}

std::string NikudHandler::stripDiacritics(const std::string& utf8_input) {
    std::string result;
    size_t i = 0;
    while (i < utf8_input.size()) {
        unsigned char c = static_cast<unsigned char>(utf8_input[i]);
        char32_t cp = 0;
        size_t len = 1;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c & 0xE0) == 0xC0) {
            cp = ((c & 0x1F) << 6) | (utf8_input[i+1] & 0x3F);
            len = 2;
        } else if ((c & 0xF0) == 0xE0) {
            cp = ((c & 0x0F) << 12) | ((utf8_input[i+1] & 0x3F) << 6) | (utf8_input[i+2] & 0x3F);
            len = 3;
        } else {
            len = 4;
        }

        if (!isNikud(cp) && !isTaam(cp) && !isDageshOrDot(cp) && cp != 0x05BF) {
            result.append(utf8_input, i, len);
        }
        i += len;
    }
    return result;
}

NikudHandler::ValidationResult NikudHandler::validateSequence(const std::string& utf8_input) {
    ValidationResult res;
    bool has_base = false;

    size_t i = 0;
    while (i < utf8_input.size()) {
        unsigned char c = static_cast<unsigned char>(utf8_input[i]);
        char32_t cp = 0;
        size_t len = 1;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c & 0xE0) == 0xC0) {
            cp = ((c & 0x1F) << 6) | (utf8_input[i+1] & 0x3F);
            len = 2;
        } else if ((c & 0xF0) == 0xE0) {
            cp = ((c & 0x0F) << 12) | ((utf8_input[i+1] & 0x3F) << 6) | (utf8_input[i+2] & 0x3F);
            len = 3;
        } else {
            len = 4;
        }

        HebrewCharType type = classify(cp);
        if (type == HebrewCharType::BaseLetter) {
            has_base = true;
        } else if (type == HebrewCharType::NikudVowel || type == HebrewCharType::TaamCantillation || type == HebrewCharType::DageshOrMapiq) {
            if (!has_base) {
                res.is_valid = false;
                res.errors.push_back("Orphan combining mark detected without preceding base letter: U+" + std::to_string(static_cast<uint32_t>(cp)));
            }
        } else {
            has_base = false;
        }
        i += len;
    }
    return res;
}

} // namespace keter
