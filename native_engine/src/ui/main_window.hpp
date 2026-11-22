#pragma once

#include <QMainWindow>
#include <memory>
#include "page_renderer_widget.hpp"
#include "../../include/keter/shaper.hpp"
#include "../../include/keter/font_manager.hpp"
#include "../../include/keter/typesetter.hpp"

namespace keter {

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget* parent = nullptr);
    ~MainWindow() override;

private slots:
    void openDocx();
    void exportPdf();
    void exportIdml();
    void runQaCheck();
    void openFontInspector();
    void onZoomChanged(int value);

private:
    void setupUi();
    void loadSampleHolyBook();

    PageRendererWidget* page_widget_{nullptr};
    std::unique_ptr<HarfBuzzShaper> shaper_;
    std::unique_ptr<FontManager> font_manager_;
};

} // namespace keter
