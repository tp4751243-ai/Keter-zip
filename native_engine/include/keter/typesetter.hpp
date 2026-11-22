#pragma once

#include "shaper.hpp"
#include <string>
#include <vector>

namespace keter {

struct TypesetWord {
    std::string text;
    ShapedRun shaped;
    double width_pt{0.0};
    bool is_space{false};
};

struct TypesetLine {
    std::vector<TypesetWord> words;
    double width_pt{0.0};
    double target_width_pt{0.0};
    double x_start_pt{0.0}; // from right margin for RTL
    double y_baseline_pt{0.0};
    double height_pt{0.0};
    double ascent_pt{0.0};
    double descent_pt{0.0};
    bool is_last_line{false};
    bool is_justified{false};
    double extra_space_per_word_pt{0.0};
};

struct TypesetParagraph {
    std::string text;
    std::vector<TypesetLine> lines;
    double total_height_pt{0.0};
    std::string style_name;
};

struct PageGeometry {
    double page_width_pt{595.28};   // A4 default or 170x240mm Holy Book standard (481.89 x 680.31 pt)
    double page_height_pt{841.89};
    double margin_top_pt{54.0};
    double margin_bottom_pt{54.0};
    double margin_inside_pt{54.0};  // Binding margin
    double margin_outside_pt{42.0};
    bool is_verso{false};           // Left vs Right page in spread
};

class LineBreaker {
public:
    static std::vector<TypesetLine> breakParagraph(
        const std::string& utf8_text,
        HarfBuzzShaper& shaper,
        double available_width_pt,
        double line_height_pt,
        bool justify = true
    );
};

} // namespace keter
