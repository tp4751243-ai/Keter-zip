#include <QTest>
#include "../include/keter/document_model.hpp"
#include <iostream>

class TestDocumentModel : public QObject {
    Q_OBJECT

private slots:
    void testUnitAdditionAndHierarchy();
    void testRavTextLinkingAndLock();
    void testIntegrityValidationPass();
    void testIntegrityValidationFailBrokenLink();
    void testTableAndImagePreservation();
};

void TestDocumentModel::testUnitAdditionAndHierarchy() {
    keter::DocumentModel doc;

    keter::ContentUnit chapter;
    chapter.id = "ch-1";
    chapter.type = keter::UnitType::PerekChapter;
    chapter.raw_text_utf8 = "פרק ראשון — מאימתי";
    doc.addUnit(chapter);

    keter::ContentUnit gemara;
    gemara.id = "gem-1";
    gemara.type = keter::UnitType::MainSource;
    gemara.raw_text_utf8 = "מאימתי קורין את שמע בערבית";
    gemara.parent_unit_id = "ch-1";
    doc.addUnit(gemara);

    QCOMPARE(doc.unitCount(), 2);
    const auto* u = doc.getUnit("gem-1");
    QVERIFY(u != nullptr);
    QCOMPARE(QString::fromUtf8(u->parent_unit_id.c_str()), QString("ch-1"));

    auto children = doc.getChildren("ch-1");
    QCOMPARE(children.size(), 1);
    QCOMPARE(QString::fromUtf8(children[0].id.c_str()), QString("gem-1"));
}

void TestDocumentModel::testRavTextLinkingAndLock() {
    keter::DocumentModel doc;

    keter::ContentUnit src;
    src.id = "src-1";
    src.type = keter::UnitType::MainSource;
    src.raw_text_utf8 = "בְּרֵאשִׁית בָּרָא אֱלֹהִים";
    doc.addUnit(src);

    keter::ContentUnit com;
    com.id = "com-1";
    com.type = keter::UnitType::PrimaryCommentary;
    com.raw_text_utf8 = "בְּרֵאשִׁית: אָמַר רַבִּי יִצְחָק";
    doc.addUnit(com);

    keter::RavTextLink link;
    link.link_id = "l-1";
    link.source_unit_id = "src-1";
    link.commentary_unit_id = "com-1";
    link.dibbur_hamatchil = "בְּרֵאשִׁית";
    link.is_user_locked = false;
    doc.addLink(link);

    QCOMPARE(doc.linkCount(), 1);
    auto links = doc.getLinksForSource("src-1");
    QCOMPARE(links.size(), 1);
    QVERIFY(!links[0].is_user_locked);

    // Test locking link (user-confirmed override)
    doc.lockLink("l-1");
    auto lockedLinks = doc.getLinksForSource("src-1");
    QVERIFY(lockedLinks[0].is_user_locked);
}

void TestDocumentModel::testIntegrityValidationPass() {
    keter::DocumentModel doc;
    keter::ContentUnit u;
    u.id = "u-valid";
    u.type = keter::UnitType::MainSource;
    u.raw_text_utf8 = "שָׁלוֹם עָלֵיכֶם";
    doc.addUnit(u);

    auto report = doc.validateIntegrity();
    QVERIFY(report.passed);
    QCOMPARE(report.errors.size(), 0);
}

void TestDocumentModel::testIntegrityValidationFailBrokenLink() {
    keter::DocumentModel doc;
    keter::ContentUnit u;
    u.id = "u-1";
    u.raw_text_utf8 = "טקסט מקור";
    doc.addUnit(u);

    // Link references non-existent commentary ID "missing-commentary"
    keter::RavTextLink broken_link;
    broken_link.link_id = "b-1";
    broken_link.source_unit_id = "u-1";
    broken_link.commentary_unit_id = "missing-commentary";
    doc.addLink(broken_link);

    auto report = doc.validateIntegrity();
    QVERIFY(!report.passed);
    QVERIFY(report.errors.size() >= 1);
}

void TestDocumentModel::testTableAndImagePreservation() {
    keter::DocumentModel doc;

    // Table unit
    keter::ContentUnit tblUnit;
    tblUnit.id = "tbl-1";
    tblUnit.type = keter::UnitType::Table;
    keter::TableData td;
    td.table_id = "tbl-1";
    keter::TableRow r;
    r.row_id = "r-1";
    keter::TableCell c1;
    c1.cell_id = "c-1";
    c1.content_utf8 = "טור א'";
    r.cells.push_back(c1);
    td.rows.push_back(r);
    tblUnit.table_data = td;
    doc.addUnit(tblUnit);

    const auto* retrieved = doc.getUnit("tbl-1");
    QVERIFY(retrieved != nullptr);
    QVERIFY(retrieved->table_data.has_value());
    QCOMPARE(retrieved->table_data.value().rows.size(), 1);
}

QTEST_MAIN(TestDocumentModel)
#include "test_document_model.moc"
