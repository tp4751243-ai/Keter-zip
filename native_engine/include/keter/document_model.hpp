#pragma once

#include <string>
#include <vector>
#include <memory>
#include <unordered_map>
#include <optional>
#include <cstdint>

namespace keter {

enum class UnitType {
    Book,
    Volume,
    Seder,
    Masechet,
    PerekChapter,
    Siman,
    Seif,
    Paragraph,
    Heading,
    MainSource,         // Gemara, Chumash, Mishnah, Shulchan Aruch
    PrimaryCommentary,  // Rashi, Onkelos, Taz
    SecondaryCommentary,// Tosafot, Ramban, Shach
    TertiaryCommentary, // Ein Mishpat, Torah Ohr, Ba'er Heitev
    Footnote,
    SideNote,           // Marginalia
    Table,
    Image,
    Chart,
    Caption,
    ListItem
};

struct TextStyle {
    std::string style_id;
    std::string style_name;
    std::string font_family{"Frank Ruhl Libre"};
    double font_size_pt{14.0};
    double line_spacing_pt{18.0};
    double space_before_pt{0.0};
    double space_after_pt{4.0};
    std::string text_align{"right"}; // right (RTL), left, center, justify
    bool is_bold{false};
    bool is_italic{false};
    bool is_underline{false};
    std::string text_color{"#141416"};
};

struct TableCell {
    std::string cell_id;
    std::string content_utf8;
    int col_span{1};
    int row_span{1};
    double width_pt{0.0};
    std::string background_color;
};

struct TableRow {
    std::string row_id;
    std::vector<TableCell> cells;
    double height_pt{0.0};
    bool is_header{false};
};

struct TableData {
    std::string table_id;
    std::vector<TableRow> rows;
    std::vector<double> column_widths_pt;
    std::string caption;
};

struct ImageData {
    std::string image_id;
    std::string source_path;
    std::string mime_type; // e.g. "image/png", "image/jpeg"
    double width_pt{0.0};
    double height_pt{0.0};
    int dpi{300};
    std::string caption;
    std::string alt_text;
    std::vector<uint8_t> raw_bytes;
};

struct RavTextLink {
    std::string link_id;
    std::string source_unit_id;
    std::string commentary_unit_id;
    std::string dibbur_hamatchil; // Lemma / Lead phrase
    bool is_user_locked{false};
    float confidence_score{1.0f};
    std::string commentary_type; // e.g. "Rashi", "Tosafot", "Ramban"
};

struct ContentUnit {
    std::string id;
    UnitType type{UnitType::Paragraph};
    std::string raw_text_utf8;
    std::string style_id;
    int order_index{0};
    int hierarchy_level{0};
    std::string parent_unit_id;
    std::vector<std::string> child_unit_ids;

    // Holy-book specific semantic metadata
    std::string dibbur_hamatchil;
    std::string siman_number;
    std::string seif_letter;
    std::string chapter_title;

    // Associated rich objects (if applicable)
    std::optional<TableData> table_data;
    std::optional<ImageData> image_data;
};

struct ValidationReport {
    bool passed{true};
    size_t total_units_inspected{0};
    size_t total_links_inspected{0};
    std::vector<std::string> errors;
    std::vector<std::string> warnings;
};

class DocumentModel {
public:
    DocumentModel();
    ~DocumentModel();

    void clear();

    // Content Units Management
    void addUnit(const ContentUnit& unit);
    const ContentUnit* getUnit(const std::string& id) const;
    ContentUnit* getMutableUnit(const std::string& id);
    std::vector<ContentUnit> getUnitsByType(UnitType type) const;
    std::vector<ContentUnit> getChildren(const std::string& parent_id) const;
    const std::vector<std::string>& getOrder() const { return unit_order_; }

    // Styles Management
    void registerStyle(const TextStyle& style);
    const TextStyle* getStyle(const std::string& style_id) const;

    // Rav-Text Relationships Management
    void addLink(const RavTextLink& link);
    std::vector<RavTextLink> getLinksForSource(const std::string& source_id) const;
    std::vector<RavTextLink> getLinksForCommentary(const std::string& commentary_id) const;
    void lockLink(const std::string& link_id);
    void unlockLink(const std::string& link_id);

    // Post-Import Integrity & Validation Engine (Section 7)
    ValidationReport validateIntegrity() const;

    // Document Metadata
    void setMetadata(const std::string& key, const std::string& val);
    std::string getMetadata(const std::string& key) const;

    size_t unitCount() const { return units_.size(); }
    size_t linkCount() const { return links_.size(); }

private:
    std::unordered_map<std::string, ContentUnit> units_;
    std::vector<std::string> unit_order_;
    std::unordered_map<std::string, TextStyle> styles_;
    std::unordered_map<std::string, RavTextLink> links_;
    std::unordered_map<std::string, std::string> metadata_;
};

} // namespace keter
