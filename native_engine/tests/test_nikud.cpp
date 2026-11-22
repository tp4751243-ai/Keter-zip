#include <QTest>
#include "../include/keter/nikud_handler.hpp"

class TestNikudTaamim : public QObject {
    Q_OBJECT

private slots:
    void testCodepointClassification();
    void testCantillationDetection();
};

void TestNikudTaamim::testCodepointClassification() {
    // 0x05D0 (Alef) -> BaseLetter
    QCOMPARE(static_cast<int>(keter::NikudHandler::classify(0x05D0)), static_cast<int>(keter::HebrewCharType::BaseLetter));
    // 0x05B7 (Patach) -> NikudVowel
    QCOMPARE(static_cast<int>(keter::NikudHandler::classify(0x05B7)), static_cast<int>(keter::HebrewCharType::NikudVowel));
    // 0x05BC (Dagesh) -> DageshOrMapiq
    QCOMPARE(static_cast<int>(keter::NikudHandler::classify(0x05BC)), static_cast<int>(keter::HebrewCharType::DageshOrMapiq));
    // 0x0591 (Etnahta) -> TaamCantillation
    QCOMPARE(static_cast<int>(keter::NikudHandler::classify(0x0591)), static_cast<int>(keter::HebrewCharType::TaamCantillation));
}

void TestNikudTaamim::testCantillationDetection() {
    QVERIFY(keter::NikudHandler::isTaam(0x0591)); // Etnahta
    QVERIFY(keter::NikudHandler::isTaam(0x0596)); // Tipcha
    QVERIFY(keter::NikudHandler::isTaam(0x05A8)); // Pashta
    QVERIFY(!keter::NikudHandler::isTaam(0x05B0)); // Sheva is not a ta'am
}

QTEST_MAIN(TestNikudTaamim)
#include "test_nikud.moc"
