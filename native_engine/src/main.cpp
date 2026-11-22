#include <QApplication>
#include "ui/page_renderer_widget.hpp"
#include "../include/keter/shaper.hpp"
#include "../include/keter/typesetter.hpp"
#include "../include/keter/nikud_handler.hpp"
#include <QMainWindow>
#include <QToolBar>
#include <QScrollArea>
#include <iostream>

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("Keter Typesetter — Jewish Holy-Book Desktop Engine");
    app.setOrganizationName("Keter Publishing Technologies");

    std::cout << "[KETER TYPESETTER] Core Engine Initializing...\n";
    std::cout << "[KETER TYPESETTER] OpenType HarfBuzz & FreeType Shaper Active.\n";
    std::cout << "[KETER TYPESETTER] Hebrew RTL & Nikud Canon Reorder Enabled.\n";

    QMainWindow window;
    window.setWindowTitle("Keter Typesetter [Milestone 1 Prototype]");
    window.resize(1100, 900);

    auto* scrollArea = new QScrollArea(&window);
    auto* pageRenderer = new keter::PageRendererWidget(scrollArea);
    scrollArea->setWidget(pageRenderer);
    scrollArea->setWidgetResizable(true);
    window.setCentralWidget(scrollArea);

    // Demonstration Typeset Text with Full Nikud & Taamim
    std::string holy_text = 
        "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃ "
        "וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל פְּנֵי תְהוֹם "
        "וְרוּחַ אֱלֹהִים מְרַחֶפֶת עַל פְּנֵי הַמָּיִם׃ "
        "וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי אוֹר׃";

    keter::HarfBuzzShaper shaper;
    keter::PageGeometry geom;
    geom.page_width_pt = 500.0;
    geom.page_height_pt = 720.0;
    geom.margin_inside_pt = 45.0;
    geom.margin_outside_pt = 45.0;
    geom.margin_top_pt = 50.0;
    geom.margin_bottom_pt = 50.0;

    double content_w = geom.page_width_pt - geom.margin_inside_pt - geom.margin_outside_pt;
    auto lines = keter::LineBreaker::breakParagraph(holy_text, shaper, content_w, 24.0, true);

    pageRenderer->setPageGeometry(geom);
    pageRenderer->setDocumentLines(lines);

    window.show();
    return app.exec();
}
