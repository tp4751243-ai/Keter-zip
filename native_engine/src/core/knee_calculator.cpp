#include "../../include/keter/document_model.hpp"
#include <cmath>
#include <algorithm>

namespace keter {

class DynamicKneeEngine {
public:
    static DynamicKneeContour calculateKnee(
        double page_content_width_pt,
        double page_content_height_pt,
        double source_total_text_height_at_full_width_pt,
        double right_commentary_height_pt,
        double left_commentary_height_pt,
        double default_source_column_width_pt
    ) {
        DynamicKneeContour contour;
        contour.top_y_pt = 0.0;
        contour.bottom_y_pt = page_content_height_pt;

        // Balance check: if commentaries are roughly equal, standard rectangular column
        double diff = std::abs(right_commentary_height_pt - left_commentary_height_pt);
        if (diff < 40.0 || (right_commentary_height_pt < 100.0 && left_commentary_height_pt < 100.0)) {
            contour.knee_junction_y_pt = page_content_height_pt;
            contour.upper_width_pt = default_source_column_width_pt;
            contour.lower_width_pt = default_source_column_width_pt;
            contour.is_left_stepped = false;
            return contour;
        }

        // Stepped knee: when Rashi or Tosafot is much longer, calculate junction point
        double junction = std::clamp(
            page_content_height_pt * (0.45 + (right_commentary_height_pt / (right_commentary_height_pt + left_commentary_height_pt + 1.0)) * 0.2),
            page_content_height_pt * 0.35,
            page_content_height_pt * 0.75
        );

        contour.knee_junction_y_pt = junction;
        contour.upper_width_pt = default_source_column_width_pt;

        if (right_commentary_height_pt > left_commentary_height_pt) {
            // Right commentary (e.g. Rashi) needs more space lower down -> step to the left
            contour.lower_width_pt = default_source_column_width_pt * 0.78;
            contour.inner_x_offset_pt = default_source_column_width_pt * 0.22;
            contour.is_left_stepped = true;
        } else {
            // Left commentary (e.g. Tosafot) needs more space lower down -> step to the right
            contour.lower_width_pt = default_source_column_width_pt * 0.78;
            contour.inner_x_offset_pt = 0.0;
            contour.is_left_stepped = false;
        }

        return contour;
    }
};

} // namespace keter
