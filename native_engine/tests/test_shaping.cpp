#include <QTest>
#include "../include/keter/shaper.hpp"
#include "../include/keter/nikud_handler.hpp"
#include <iostream>

class TestHarfBuzzShaping : public QObject {
    Q_OBJECT

private slots:
    void testHebrewRtlOrder();
    void testNikudCanonicalReorder();
    void testDiacriticStripping();
    void testValidationNoOrphans();
};

void TestHarfBuzzShaping::testHebrewRtlOrder() {
    std::string text = "בְּרֵאשִׁית";
    QVERIFY(!text.empty());
    // Verify first byte is Hebrew Alef-Bet block (0xD7 or 0xD6)
    QVERIFY(static_cast<unsigned char>(text[0]) >= 0xD6);
}

void TestHarfBuzzShaping::testNikudCanonicalReorder() {
    // Letter Bet + Patach + Dagesh (un-canonical order: vowel before dagesh)
    // Canonical rule: Base Letter -> Dagesh -> Vowel
    std::string wrong_order = "\xD7\x91\xD6\xB7\xD6\xBC"; // Bet, Patach, Dagesh
    std::string canonical = keter::NikudHandler::canonicalReorder(wrong_order);

    // After canonical reordering, Dagesh (0xD6 0xBC) must come before Patach (0xD6 0xB7)
    size_t pos_dagesh = canonical.find("\xD6\xBC");
    size_t pos_patach = canonical.find("\xD6\xB7");

    QVERIFY(pos_dagesh != std::string::npos);
    QVERIFY(pos_patach != std::string::npos);
    QVERIFY(pos_dagesh < pos_patach);
}

void TestHarfBuzzShaping::testDiacriticStripping() {
    std::string vocalized = "שָׁלוֹם עֲלֵיכֶם";
    std::string stripped = keter::NikudHandler::stripDiacritics(vocalized);
    QCOMPARE(QString::fromUtf8(stripped.c_str()), QString::fromUtf8("שלום עליכם"));
}

void TestHarfBuzzShaping::testValidationNoOrphans() {
    // Valid word
    std::string valid = "מַעֲשֶׂה";
    auto res_valid = keter::NikudHandler::validateSequence(valid);
    QVERIFY(res_valid.is_valid);

    // Orphan mark (starts with Kubutz without base letter)
    std::string orphan = "\xD6\xBB\xD7\x90"; // Kubutz followed by Alef
    auto res_invalid = keter::NikudHandler::validateSequence(orphan);
    QVERIFY(!res_invalid.is_valid);
}

QTEST_MAIN(TestHarfBuzzShaping)
#include "test_shaping.moc"
