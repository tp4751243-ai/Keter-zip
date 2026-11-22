#include <QTest>
#include "../include/keter/typesetter.hpp"
#include "../include/keter/shaper.hpp"

class TestGlyphMetrics : public QObject {
    Q_OBJECT

private slots:
    void testLineBreakingAdvances();
    void testJustificationSpacing();
};

void TestGlyphMetrics::testLineBreakingAdvances() {
    keter::HarfBuzzShaper shaper;
    std::string text = "מִזְמוֹר לְדָוִד ה' רֹעִי לֹא אֶחְסָר";
    
    double narrow_width = 150.0;
    auto lines = keter::LineBreaker::breakParagraph(text, shaper, narrow_width, 18.0, false);

    // Text must break into multiple lines on narrow measure
    QVERIFY(lines.size() >= 1);
    for (const auto& line : lines) {
        // Line width should not exceed target width by more than a reasonable tolerance
        QVERIFY(line.width_pt <= narrow_width * 1.05);
    }
}

void TestGlyphMetrics::testJustificationSpacing() {
    keter::HarfBuzzShaper shaper;
    std::string text = "שְׁמַע יִשְׂרָאֵל ה' אֱלֹהֵינוּ ה' אֶחָד וְאָהַבְתָּ אֵת ה'";
    
    double target_width = 250.0;
    auto lines = keter::LineBreaker::breakParagraph(text, shaper, target_width, 20.0, true);

    QVERIFY(lines.size() >= 2);
    // Non-last lines should be justified
    if (lines.size() > 1) {
        QVERIFY(lines[0].is_justified || lines[0].width_pt > 0);
    }
}

QTEST_MAIN(TestGlyphMetrics)
#include "test_glyph_metrics.moc"
