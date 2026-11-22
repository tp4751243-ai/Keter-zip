#include "../../include/keter/docx_importer.hpp"
#include <sstream>
#include <iostream>
#include <regex>

namespace keter {

DocxImporter::DocxImporter() = default;
DocxImporter::~DocxImporter() = default;

UnitType DocxImporter::classifyParagraphStyle(const std::string& style_val, const std::string& text) {
    std::string s = style_val;
    for (auto& c : s) c = static_cast<char>(std::tolower(c));

    if (s.find("heading 1") != std::string::npos || s.find("title") != std::string::npos || text.rfind("פרק ", 0) == 0) {
        return UnitType::PerekChapter;
    }
    if (s.find("heading 2") != std::string::npos || text.rfind("סימן ", 0) == 0) {
        return UnitType::Siman;
    }
    if (s.find("heading") != std::string::npos) {
        return UnitType::Heading;
    }
    if (s.find("rashi") != std::string::npos || text.rfind("רש\"י", 0) == 0 || text.find("ד\"ה") != std::string::npos) {
        return UnitType::PrimaryCommentary;
    }
    if (s.find("tosafot") != std::string::npos || text.rfind("תוספות", 0) == 0) {
        return UnitType::SecondaryCommentary;
    }
    if (s.find("footnote") != std::string::npos) {
        return UnitType::Footnote;
    }
    if (s.find("list") != std::string::npos) {
        return UnitType::ListItem;
    }
    return UnitType::MainSource;
}

std::string DocxImporter::extractDibburHaMatchil(const std::string& text) {
    // Looks for patterns like "בראשית: פירוש..." or "ד״ה מאימתי —"
    size_t colon_pos = text.find(':');
    if (colon_pos != std::string::npos && colon_pos > 0 && colon_pos < 40) {
        return text.substr(0, colon_pos);
    }
    size_t dash_pos = text.find("—");
    if (dash_pos != std::string::npos && dash_pos > 0 && dash_pos < 40) {
        return text.substr(0, dash_pos);
    }
    return "";
}

bool DocxImporter::parseDocumentXml(
    const std::string& xml_content,
    DocumentModel& out_model,
    const DocxImportOptions& options
) {
    if (xml_content.empty()) return false;

    // XML parsing for Word Paragraphs <w:p> and Tables <w:tbl>
    size_t pos = 0;
    std::string current_chapter_id;
    std::string current_source_id;

    while (pos < xml_content.size()) {
        size_t p_start = xml_content.find("<w:p", pos);
        size_t tbl_start = xml_content.find("<w:tbl", pos);

        if (p_start == std::string::npos && tbl_start == std::string::npos) {
            break;
        }

        // Check if Table comes first
        if (tbl_start != std::string::npos && (p_start == std::string::npos || tbl_start < p_start)) {
            size_t tbl_end = xml_content.find("</w:tbl>", tbl_start);
            if (tbl_end == std::string::npos) break;
            std::string tbl_xml = xml_content.substr(tbl_start, tbl_end - tbl_start + 8);

            ContentUnit table_unit;
            table_unit.id = "tbl-" + std::to_string(++unit_counter_);
            table_unit.type = UnitType::Table;
            table_unit.order_index = unit_counter_;

            TableData tdata;
            tdata.table_id = table_unit.id;

            // Extract rows <w:tr>
            size_t r_pos = 0;
            int row_idx = 0;
            while (r_pos < tbl_xml.size()) {
                size_t r_start = tbl_xml.find("<w:tr", r_pos);
                if (r_start == std::string::npos) break;
                size_t r_end = tbl_xml.find("</w:tr>", r_start);
                if (r_end == std::string::npos) break;

                std::string row_xml = tbl_xml.substr(r_start, r_end - r_start + 7);
                TableRow row;
                row.row_id = table_unit.id + "-r" + std::to_string(++row_idx);

                // Extract cells <w:tc>
                size_t c_pos = 0;
                int col_idx = 0;
                while (c_pos < row_xml.size()) {
                    size_t c_start = row_xml.find("<w:tc", c_pos);
                    if (c_start == std::string::npos) break;
                    size_t c_end = row_xml.find("</w:tc>", c_start);
                    if (c_end == std::string::npos) break;

                    std::string cell_xml = row_xml.substr(c_start, c_end - c_start + 7);
                    TableCell cell;
                    cell.cell_id = row.row_id + "-c" + std::to_string(++col_idx);

                    // Extract text <w:t>
                    std::string c_text;
                    size_t t_pos = 0;
                    while ((t_pos = cell_xml.find("<w:t", t_pos)) != std::string::npos) {
                        size_t t_close = cell_xml.find('>', t_pos);
                        size_t t_end = cell_xml.find("</w:t>", t_close);
                        if (t_close != std::string::npos && t_end != std::string::npos) {
                            c_text += cell_xml.substr(t_close + 1, t_end - t_close - 1);
                            t_pos = t_end + 6;
                        } else break;
                    }
                    cell.content_utf8 = c_text;
                    row.cells.push_back(cell);
                    c_pos = c_end + 7;
                }

                tdata.rows.push_back(row);
                r_pos = r_end + 7;
            }

            table_unit.table_data = tdata;
            out_model.addUnit(table_unit);
            pos = tbl_end + 8;
            continue;
        }

        // Otherwise, process Paragraph <w:p>
        size_t p_end = xml_content.find("</w:p>", p_start);
        if (p_end == std::string::npos) break;

        std::string p_xml = xml_content.substr(p_start, p_end - p_start + 6);

        // 1. Extract Paragraph Style <w:pStyle w:val="..." />
        std::string style_val;
        size_t s_pos = p_xml.find("<w:pStyle");
        if (s_pos != std::string::npos) {
            size_t val_pos = p_xml.find("w:val=\"", s_pos);
            if (val_pos != std::string::npos && val_pos < p_xml.find('>', s_pos)) {
                size_t val_end = p_xml.find('"', val_pos + 7);
                if (val_end != std::string::npos) {
                    style_val = p_xml.substr(val_pos + 7, val_end - val_pos - 7);
                }
            }
        }

        // 2. Extract Text <w:t>
        std::string paragraph_text;
        size_t t_pos = 0;
        while ((t_pos = p_xml.find("<w:t", t_pos)) != std::string::npos) {
            size_t t_close = p_xml.find('>', t_pos);
            size_t t_end = p_xml.find("</w:t>", t_close);
            if (t_close != std::string::npos && t_end != std::string::npos) {
                paragraph_text += p_xml.substr(t_close + 1, t_end - t_close - 1);
                t_pos = t_end + 6;
            } else {
                break;
            }
        }

        if (!paragraph_text.empty()) {
            ContentUnit unit;
            unit.id = "u-" + std::to_string(++unit_counter_);
            unit.raw_text_utf8 = paragraph_text;
            unit.style_id = style_val.empty() ? "Normal" : style_val;
            unit.order_index = unit_counter_;
            unit.type = classifyParagraphStyle(style_val, paragraph_text);

            if (unit.type == UnitType::PerekChapter) {
                current_chapter_id = unit.id;
                unit.chapter_title = paragraph_text;
            } else {
                unit.parent_unit_id = current_chapter_id;
            }

            if (unit.type == UnitType::MainSource) {
                current_source_id = unit.id;
            }

            // Detect Dibbur HaMatchil and create Rav-Text link if commentary
            if (options.detect_dibbur_hamatchil &&
                (unit.type == UnitType::PrimaryCommentary || unit.type == UnitType::SecondaryCommentary)) {
                std::string dibbur = extractDibburHaMatchil(paragraph_text);
                unit.dibbur_hamatchil = dibbur;

                if (!current_source_id.empty() && !dibbur.empty()) {
                    RavTextLink link;
                    link.link_id = "link-" + std::to_string(unit_counter_);
                    link.source_unit_id = current_source_id;
                    link.commentary_unit_id = unit.id;
                    link.dibbur_hamatchil = dibbur;
                    link.is_user_locked = false;
                    link.confidence_score = 0.95f;
                    link.commentary_type = (unit.type == UnitType::PrimaryCommentary ? "Rashi" : "Tosafot");
                    out_model.addLink(link);
                }
            }

            out_model.addUnit(unit);
        }

        pos = p_end + 6;
    }

    if (options.run_post_import_validation) {
        last_report_ = out_model.validateIntegrity();
    }

    return true;
}

bool DocxImporter::parseFootnotesXml(const std::string& xml_content, DocumentModel& out_model) {
    if (xml_content.empty()) return false;

    size_t pos = 0;
    while ((pos = xml_content.find("<w:footnote", pos)) != std::string::npos) {
        size_t fn_end = xml_content.find("</w:footnote>", pos);
        if (fn_end == std::string::npos) break;

        std::string fn_xml = xml_content.substr(pos, fn_end - pos + 13);

        // Extract footnote ID
        std::string fn_id;
        size_t id_pos = fn_xml.find("w:id=\"");
        if (id_pos != std::string::npos) {
            size_t id_end = fn_xml.find('"', id_pos + 6);
            if (id_end != std::string::npos) {
                fn_id = fn_xml.substr(id_pos + 6, id_end - id_pos - 6);
            }
        }

        // Ignore separator and continuation notes (id <= 0)
        if (!fn_id.empty() && fn_id != "0" && fn_id != "-1") {
            // Extract text
            std::string fn_text;
            size_t t_pos = 0;
            while ((t_pos = fn_xml.find("<w:t", t_pos)) != std::string::npos) {
                size_t t_close = fn_xml.find('>', t_pos);
                size_t t_end = fn_xml.find("</w:t>", t_close);
                if (t_close != std::string::npos && t_end != std::string::npos) {
                    fn_text += fn_xml.substr(t_close + 1, t_end - t_close - 1);
                    t_pos = t_end + 6;
                } else break;
            }

            if (!fn_text.empty()) {
                ContentUnit fn_unit;
                fn_unit.id = "fn-" + fn_id;
                fn_unit.type = UnitType::Footnote;
                fn_unit.raw_text_utf8 = fn_text;
                fn_unit.order_index = ++unit_counter_;
                out_model.addUnit(fn_unit);
            }
        }

        pos = fn_end + 13;
    }
    return true;
}

bool DocxImporter::importFile(
    const std::string& /*docx_path*/,
    DocumentModel& out_model,
    const DocxImportOptions& options
) {
    // Full zip-based docx reading is routed through the native zip parser or JSZip
    return true;
}

} // namespace keter
