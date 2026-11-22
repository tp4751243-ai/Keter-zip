#pragma once

#include <string>
#include <vector>
#include <cstdint>

namespace keter {

enum class HebrewCharType {
    BaseLetter,      // U+05D0 to U+05EA
    NikudVowel,      // U+05B0 to U+05BB, U+05C7 (Kamatz Katan)
    DageshOrMapiq,   // U+05BC
    ShinSinDot,      // U+05C1, U+05C2
    Rafe,            // U+05BF
    TaamCantillation,// U+0591 to U+05AF (Etnahta, Pashta, Zakef, etc.)
    Punctuation,     // U+05BE (Maqaf), U+05C0 (Paseq), U+05C3 (Sof Pasuk)
    Other
};

struct HebrewCharInfo {
    char32_t codepoint;
    HebrewCharType type;
    const char* name_en;
    const char* name_he;
    bool is_combining;
};

class NikudHandler {
public:
    static bool isHebrew(char32_t cp);
    static bool isNikud(char32_t cp);
    static bool isTaam(char32_t cp);
    static bool isDageshOrDot(char32_t cp);
    static HebrewCharType classify(char32_t cp);
    static HebrewCharInfo getInfo(char32_t cp);

    // Canonical reordering of marks according to Hebrew typesetting rules:
    // Base Letter -> Dagesh/Mapiq -> Shin/Sin Dot -> Nikud Vowel -> Taam (Cantillation)
    static std::string canonicalReorder(const std::string& utf8_input);

    // Strips nikud and taamim if consonantal comparison is required
    static std::string stripDiacritics(const std::string& utf8_input);

    // Validate that marks are attached to valid base letters
    struct ValidationResult {
        bool is_valid{true};
        std::vector<std::string> warnings;
        std::vector<std::string> errors;
    };
    static ValidationResult validateSequence(const std::string& utf8_input);
};

} // namespace keter
