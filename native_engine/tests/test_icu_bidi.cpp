#include <QTest>
#include "../include/keter/typography_engine.hpp"

class TestIcuBidi : public QObject {
    Q_OBJECT

private slots:
    void testHebrewRtlRun();
    void testMixedHebrewEnglishRun();
    void testUnicodeNfcNormalization();
};

void TestIcuBidi::testHebrewRtlRun() {
    keter::TypographyEngine engine;
    std::string pure_hebrew = "בְּרֵאשִׁית בָּרָא אֱלֹהִים";
    auto runs = engine.analyzeBidi(pure_hebrew);

    QVERIFY(!runs.empty());
    // All runs must be RTL
    for (const auto& r : runs) {
        QVERIFY(r.is_rtl());
    }
}

void TestIcuBidi::testMixedHebrewEnglishRun() {
    keter::TypographyEngine engine;
    // Mixed Hebrew and English
    std::string mixed = "ספר Genesis פרק א";
    auto runs = engine.analyzeBidi(mixed);

    // Should break into multiple BiDi runs (Hebrew RTL, English LTR, Hebrew RTL)
    QVERIFY(runs.size() >= 2);
}

void TestIcuBidi::testUnicodeNfcNormalization() {
    keter::TypographyEngine engine;
    // Letter Bet + Patach decomposed vs composed
    std::string text = "בַּ";
    std::string nfc = engine.normalizeNFC(text);
    QVERIFY(!nfc.empty());
}

QTEST_MAIN(TestIcuBidi)
#include "test_icu_bidi.moc"
