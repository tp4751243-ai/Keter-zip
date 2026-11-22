#include "../../include/keter/typesetter.hpp"
#include <sstream>
#include <cmath>

namespace keter {

std::vector<TypesetLine> LineBreaker::breakParagraph(
    const std::string& utf8_text,
    HarfBuzzShaper& shaper,
    double available_width_pt,
    double line_height_pt,
    bool justify
) {
    std::vector<TypesetLine> lines;
    if (utf8_text.empty() || available_width_pt <= 0) return lines;

    // Split into tokens (words and spaces)
    std::vector<TypesetWord> words;
    std::string current;
    for (size_t i = 0; i < utf8_text.size(); ++i) {
        char c = utf8_text[i];
        if (c == ' ' || c == '\t' || c == '\n') {
            if (!current.empty()) {
                TypesetWord w;
                w.text = current;
                w.shaped = shaper.shapeText(current);
                w.width_pt = w.shaped.total_advance;
                w.is_space = false;
                words.push_back(w);
                current.clear();
            }
            TypesetWord sw;
            sw.text = " ";
            sw.shaped = shaper.shapeText(" ");
            sw.width_pt = sw.shaped.total_advance;
            sw.is_space = true;
            words.push_back(sw);
        } else {
            current.push_back(c);
        }
    }
    if (!current.empty()) {
        TypesetWord w;
        w.text = current;
        w.shaped = shaper.shapeText(current);
        w.width_pt = w.shaped.total_advance;
        w.is_space = false;
        words.push_back(w);
    }

    // Line assembly loop using exact HarfBuzz advances
    TypesetLine current_line;
    current_line.target_width_pt = available_width_pt;
    current_line.height_pt = line_height_pt;
    current_line.ascent_pt = shaper.getAscent();
    current_line.descent_pt = shaper.getDescent();

    double space_width = shaper.shapeText(" ").total_advance;
    if (space_width <= 0) space_width = shaper.getLineHeight() * 0.25;

    for (size_t i = 0; i < words.size(); ++i) {
        const auto& word = words[i];
        if (word.is_space) {
            if (!current_line.words.empty()) {
                current_line.words.push_back(word);
                current_line.width_pt += word.width_pt;
            }
            continue;
        }

        // Check if adding this word exceeds available width
        double test_width = current_line.width_pt + word.width_pt;
        if (test_width > available_width_pt && !current_line.words.empty()) {
            // Trim trailing space if any
            while (!current_line.words.empty() && current_line.words.back().is_space) {
                current_line.width_pt -= current_line.words.back().width_pt;
                current_line.words.pop_back();
            }

            // Calculate justification expansion
            int space_count = 0;
            for (const auto& w : current_line.words) {
                if (w.is_space) space_count++;
            }

            if (justify && space_count > 0) {
                double deficit = available_width_pt - current_line.width_pt;
                // Only justify if deficit is reasonable (< 25% of line)
                if (deficit > 0 && deficit < (available_width_pt * 0.30)) {
                    current_line.extra_space_per_word_pt = deficit / space_count;
                    current_line.is_justified = true;
                    current_line.width_pt = available_width_pt;
                }
            }

            current_line.is_last_line = false;
            lines.push_back(current_line);

            // Start new line
            current_line = TypesetLine();
            current_line.target_width_pt = available_width_pt;
            current_line.height_pt = line_height_pt;
            current_line.ascent_pt = shaper.getAscent();
            current_line.descent_pt = shaper.getDescent();
        }

        current_line.words.push_back(word);
        current_line.width_pt += word.width_pt;
    }

    // Flush last line
    if (!current_line.words.empty()) {
        // Trim trailing space
        while (!current_line.words.empty() && current_line.words.back().is_space) {
            current_line.width_pt -= current_line.words.back().width_pt;
            current_line.words.pop_back();
        }
        current_line.is_last_line = true;
        current_line.is_justified = false; // Never force-justify paragraph ending
        lines.push_back(current_line);
    }

    // Set vertical baseline positions
    double y = current_line.ascent_pt;
    for (auto& line : lines) {
        line.y_baseline_pt = y;
        y += line_height_pt;
    }

    return lines;
}

} // namespace keter
