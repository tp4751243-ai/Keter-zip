#pragma once

#include <QWidget>
#include <QPainter>
#include <vector>
#include "../../include/keter/shaper.hpp"
#include "../../include/keter/typesetter.hpp"

namespace keter {

class PageRendererWidget : public QWidget {
    Q_OBJECT

public:
    explicit PageRendererWidget(QWidget* parent = nullptr);
    ~PageRendererWidget() override;

    void setDocumentLines(const std::vector<TypesetLine>& lines);
    void setPageGeometry(const PageGeometry& geom);
    void setZoomFactor(double zoom);
    void toggleShowBaselines(bool show);
    void toggleShowMarkAnchors(bool show);

protected:
    void paintEvent(QPaintEvent* event) override;

private:
    std::vector<TypesetLine> lines_;
    PageGeometry geometry_;
    double zoom_factor_{1.0};
    bool show_baselines_{true};
    bool show_mark_anchors_{true};
};

} // namespace keter
