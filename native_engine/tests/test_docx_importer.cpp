#include <QTest>
#include "../include/keter/docx_importer.hpp"
#include "../include/keter/document_model.hpp"

class TestDocxImporter : public QObject {
    Q_OBJECT

private slots:
    void testXmlParagraphParsing();
    void testDibburHaMatchilExtraction();
    void testFootnotesParsing();
    void testTableExtraction();
};

void TestDocxImporter::testXmlParagraphParsing() {
    keter::DocxImporter importer;
    keter::DocumentModel model;

    std::string sample_xml = 
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
        "  <w:body>"
        "    <w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>פרק ראשון</w:t></w:r></w:p>"
        "    <w:p><w:r><w:t>מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית</w:t></w:r></w:p>"
        "    <w:p><w:pPr><w:pStyle w:val=\"Rashi\"/></w:pPr><w:r><w:t>מֵאֵימָתַי: מֵאֵיזֶה זְמַן</w:t></w:r></w:p>"
        "  </w:body>"
        "</w:document>";

    bool ok = importer.parseDocumentXml(sample_xml, model);
    QVERIFY(ok);
    QCOMPARE(model.unitCount(), 3);

    const auto* p1 = model.getUnit("u-1");
    QVERIFY(p1 != nullptr);
    QCOMPARE(static_cast<int>(p1->type), static_cast<int>(keter::UnitType::PerekChapter));

    // Verify Rav-Text link was automatically established between Gemara and Rashi
    QCOMPARE(model.linkCount(), 1);
}

void TestDocxImporter::testDibburHaMatchilExtraction() {
    keter::DocxImporter importer;
    keter::DocumentModel model;

    std::string sample_xml = 
        "<w:document>"
        "  <w:p><w:r><w:t>בְּרֵאשִׁית בָּרָא אֱלֹהִים</w:t></w:r></w:p>"
        "  <w:p><w:pPr><w:pStyle w:val=\"Rashi\"/></w:pPr><w:r><w:t>בְּרֵאשִׁית: אָמַר רַבִּי יִצְחָק</w:t></w:r></w:p>"
        "</w:document>";

    importer.parseDocumentXml(sample_xml, model);
    auto links = docxLinks:
    auto links = model.getLinksForSource("u-1");
    QCOMPARE(links.size(), 1);
    QCOMPARE(QString::fromUtf8(links[0].dibbur_hamatchil.c_str()), QString::fromUtf8("בְּרֵאשִׁית"));
}

void TestDocxImporter::testFootnotesParsing() {
    keter::DocxImporter importer;
    keter::DocumentModel model;

    std::string fn_xml = 
        "<w:footnotes>"
        "  <w:footnote w:id=\"-1\" w:type=\"separator\"/>"
        "  <w:footnote w:id=\"1\"><w:p><w:r><w:t>הערת שוליים למשנה</w:t></w:r></w:p></w:footnote>"
        "</w:footnotes>";

    bool ok = importer.parseFootnotesXml(fn_xml, model);
    QVERIFY(ok);
    const auto* fn = model.getUnit("fn-1");
    QVERIFY(fn != nullptr);
    QCOMPARE(static_cast<int>(fn->type), static_cast<int>(keter::UnitType::Footnote));
}

void TestDocxImporter::testTableExtraction() {
    keter::DocxImporter importer;
    keter::DocumentModel model;

    std::string tbl_xml = 
        "<w:document>"
        "  <w:tbl>"
        "    <w:tr>"
        "      <w:tc><w:p><w:r><w:t>תא 1</w:t></w:r></w:p></w:tc>"
        "      <w:tc><w:p><w:r><w:t>תא 2</w:t></w:r></w:p></w:tc>"
        "    </w:tr>"
        "  </w:tbl>"
        "</w:document>";

    bool ok = importer.parseDocumentXml(tbl_xml, model);
    QVERIFY(ok);
    auto tables = model.getUnitsByType(keter::UnitType::Table);
    QCOMPARE(tables.size(), 1);
    QVERIFY(tables[0].table_data.has_value());
    QCOMPARE(tables[0].table_data.value().rows.size(), 1);
    QCOMPARE(tables[0].table_data.value().rows[0].cells.size(), 2);
}

QTEST_MAIN(TestDocxImporter)
#include "test_docx_importer.moc"
