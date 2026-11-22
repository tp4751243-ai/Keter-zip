#include "page_renderer_widget.hpp"
#include <QPaintEvent>
#include <QFont>
#include <QFontMetricsF>

namespace keter {

PageRendererWidget::PageRendererWidget(QWidget* parent)
    : QWidget(parent) {
    setAttribute(Qt::WA_OpaquePaintEvent);
    setMinimumSize(600, 850);
}

PageRendererWidget::~PageRendererWidget() = default;

void PageRendererWidget::setDocumentLines(const std::vector<TypesetLine>& lines) {
    lines_ = lines;
    update();
}

void PageRendererWidget::setPageGeometry(const PageGeometry& geom) {
    geometry_ = geom;
    update();
}

void PageRendererWidget::setZoomFactor(double zoom) {
    zoom_factor_ = zoom;
    update();
}

void PageRendererWidget::toggleShowBaselines(bool show) {
    show_baselines_ = show;
    update();
}

void PageRendererWidget::toggleShowMarkAnchors(bool show) {
    show_mark_anchors_ = show;
    update();
}

void PageRendererWidget::paintEvent(QPaintEvent* /*event*/) {
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setRenderHint(QPainter::TextAntialiasing);

    // Background: Warm desktop parchment / workstation dark surrounding
    painter.fillRect(rect(), QColor(32, 34, 37));

    // Calculate physical page rect on screen
    double p_width = geometry_.page_width_pt * zoom_factor_;
    double p_height = geometry_.page_height_pt * zoom_factor_;
    double page_x = (width() - p_width) / 2.0;
    double page_y = 20.0;

    QRectF page_rect(page_x, page_y, p_width, p_height);

    // Page drop shadow
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor(15, 15, 18, 160));
    painter.drawRoundedRect(page_rect.translated(4, 6), 4, 4);

    // White / Warm cream holy-book parchment page surface
    painter.setBrush(QColor(254, 253, 249));
    painter.drawRect(page_rect);

    // Margin boundaries
    double top_m = geometry_.margin_top_pt * zoom_factor_;
    double bottom_m = geometry_.margin_bottom_pt * zoom_factor_;
    double inside_m = geometry_.margin_inside_pt * zoom_factor_;
    double outside_m = geometry_.margin_outside_pt * zoom_factor_;

    double content_x = page_x + (geometry_.is_verso ? outside_m : inside_m);
    double content_y = page_y + top_m;
    double content_w = p_width - inside_m - outside_m;
    double content_h = p_height - top_m - bottom_m;

    QRectF content_rect(content_x, content_y, content_w, content_h);

    if (show_baselines_) {
        // Subtle margin guide lines
        painter.setPen(QPen(QColor(210, 195, 175, 120), 1.0, Qt::DashLine));
        painter.drawRect(content_rect);
    }

    // Typography rendering with RTL alignment
    QFont hebrewFont("Frank Ruhl Libre", static_cast<int>(14 * zoom_factor_));
    hebrewFont.setStyleStrategy(QFont::PreferAntialias);
    painter.setFont(hebrewFont);
    painter.setPen(QColor(20, 20, 22));

    for (const auto& line : lines_) {
        double line_y = content_y + (line.y_baseline_pt * zoom_factor_);

        if (show_baselines_) {
            painter.setPen(QPen(QColor(220, 200, 180, 80), 0.75, Qt::SolidLine));
            painter.drawLine(QPointF(content_x, line_y), QPointF(content_x + content_w, line_y));
        }

        // Draw line words RTL from right margin
        double current_x = content_x + content_w;

        for (const auto& word : line.words) {
            double word_w = word.width_pt * zoom_factor_;
            if (line.is_justified && word.is_space) {
                word_w += (line.extra_space_per_word_pt * zoom_factor_);
            }

            current_x -= word_w;

            if (!word.is_space) {
                painter.setPen(QColor(20, 20, 22));
                painter.drawText(QPointF(current_x, line_y), QString::fromUtf8(word.text.c_str()));

                if (show_mark_anchors_) {
                    // Draw tiny anchor indicator for Nikud verification
                    painter.setPen(QPen(QColor(190, 80, 50, 90), 1.0));
                    painter.drawEllipse(QPointF(current_x + word_w / 2.0, line_y + 4.0), 1.5, 1.5);
                }
            }
        }
    }
}

} // namespace keter
