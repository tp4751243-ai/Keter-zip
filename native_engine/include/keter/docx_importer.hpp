#pragma once

#include "document_model.hpp"
#include <string>
#include <vector>

namespace keter {

struct DocxImportOptions {
    bool detect_dibbur_hamatchil{true};
    bool auto_extract_footnotes{true};
    bool preserve_character_styles{true};
    bool run_post_import_validation{true};
    std::string default_hebrew_font{"Frank Ruhl Libre"};
};

class DocxImporter {
public:
    DocxImporter();
    ~DocxImporter();

    // Imports a DOCX file into the internal DocumentModel
    bool importFile(
        const std::string& docx_path,
        DocumentModel& out_model,
        const DocxImportOptions& options = DocxImportOptions{}
    );

    // Parses raw XML extracted from word/document.xml
    bool parseDocumentXml(
        const std::string& xml_content,
        DocumentModel& out_model,
        const DocxImportOptions& options = DocxImportOptions{}
    );

    // Parses raw XML extracted from word/footnotes.xml
    bool parseFootnotesXml(
        const std::string& xml_content,
        DocumentModel& out_model
    );

    const ValidationReport& getLastValidationReport() const { return last_report_; }

private:
    ValidationReport last_report_;
    std::string current_document_title_;
    int unit_counter_{0};

    UnitType classifyParagraphStyle(const std::string& style_val, const std::string& text);
    std::string extractDibburHaMatchil(const std::string& text);
};

} // namespace keter
