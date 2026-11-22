#include "../../include/keter/document_model.hpp"
#include "../../include/keter/nikud_handler.hpp"
#include <algorithm>

namespace keter {

DocumentModel::DocumentModel() = default;
DocumentModel::~DocumentModel() = default;

void DocumentModel::clear() {
    units_.clear();
    unit_order_.clear();
    styles_.clear();
    links_.clear();
    metadata_.clear();
}

void DocumentModel::addUnit(const ContentUnit& unit) {
    units_[unit.id] = unit;
    if (std::find(unit_order_.begin(), unit_order_.end(), unit.id) == unit_order_.end()) {
        unit_order_.push_back(unit.id);
    }
    // Update parent's child list if specified
    if (!unit.parent_unit_id.empty()) {
        auto p_it = units_.find(unit.parent_unit_id);
        if (p_it != units_.end()) {
            p_it->second.child_unit_ids.push_back(unit.id);
        }
    }
}

const ContentUnit* DocumentModel::getUnit(const std::string& id) const {
    auto it = units_.find(id);
    if (it != units_.end()) {
        return &it->second;
    }
    return nullptr;
}

ContentUnit* DocumentModel::getMutableUnit(const std::string& id) {
    auto it = units_.find(id);
    if (it != units_.end()) {
        return &it->second;
    }
    return nullptr;
}

std::vector<ContentUnit> DocumentModel::getUnitsByType(UnitType type) const {
    std::vector<ContentUnit> res;
    for (const auto& id : unit_order_) {
        const auto& u = units_.at(id);
        if (u.type == type) {
            res.push_back(u);
        }
    }
    return res;
}

std::vector<ContentUnit> DocumentModel::getChildren(const std::string& parent_id) const {
    std::vector<ContentUnit> res;
    auto it = units_.find(parent_id);
    if (it == units_.end()) return res;

    for (const auto& child_id : it->second.child_unit_ids) {
        auto cit = units_.find(child_id);
        if (cit != units_.end()) {
            res.push_back(cit->second);
        }
    }
    return res;
}

void DocumentModel::registerStyle(const TextStyle& style) {
    styles_[style.style_id] = style;
}

const TextStyle* DocumentModel::getStyle(const std::string& style_id) const {
    auto it = styles_.find(style_id);
    if (it != styles_.end()) {
        return &it->second;
    }
    return nullptr;
}

void DocumentModel::addLink(const RavTextLink& link) {
    links_[link.link_id] = link;
}

std::vector<RavTextLink> DocumentModel::getLinksForSource(const std::string& source_id) const {
    std::vector<RavTextLink> res;
    for (const auto& kv : links_) {
        if (kv.second.source_unit_id == source_id) {
            res.push_back(kv.second);
        }
    }
    return res;
}

std::vector<RavTextLink> DocumentModel::getLinksForCommentary(const std::string& commentary_id) const {
    std::vector<RavTextLink> res;
    for (const auto& kv : links_) {
        if (kv.second.commentary_unit_id == commentary_id) {
            res.push_back(kv.second);
        }
    }
    return res;
}

void DocumentModel::lockLink(const std::string& link_id) {
    auto it = links_.find(link_id);
    if (it != links_.end()) {
        it->second.is_user_locked = true;
    }
}

void DocumentModel::unlockLink(const std::string& link_id) {
    auto it = links_.find(link_id);
    if (it != links_.end()) {
        it->second.is_user_locked = false;
    }
}

void DocumentModel::setMetadata(const std::string& key, const std::string& val) {
    metadata_[key] = val;
}

std::string DocumentModel::getMetadata(const std::string& key) const {
    auto it = metadata_.find(key);
    if (it != metadata_.end()) return it->second;
    return "";
}

ValidationReport DocumentModel::validateIntegrity() const {
    ValidationReport report;
    report.total_units_inspected = units_.size();
    report.total_links_inspected = links_.size();

    // 1. Verify Unit IDs and Parent Hierarchy
    for (const auto& kv : units_) {
        const auto& u = kv.second;
        if (u.id.empty()) {
            report.passed = false;
            report.errors.push_back("ContentUnit encountered with empty ID.");
        }
        if (!u.parent_unit_id.empty() && units_.find(u.parent_unit_id) == units_.end()) {
            report.passed = false;
            report.errors.push_back("Unit '" + u.id + "' references non-existent parent '" + u.parent_unit_id + "'.");
        }

        // Check text content for orphan diacritics
        if (!u.raw_text_utf8.empty()) {
            auto val = NikudHandler::validateSequence(u.raw_text_utf8);
            if (!val.is_valid) {
                report.passed = false;
                for (const auto& err : val.errors) {
                    report.errors.push_back("Unit '" + u.id + "': " + err);
                }
            }
        }

        // Check Table integrity
        if (u.table_data.has_value()) {
            const auto& t = u.table_data.value();
            if (t.rows.empty()) {
                report.warnings.push_back("Table unit '" + u.id + "' contains zero rows.");
            }
            for (const auto& r : t.rows) {
                if (r.cells.empty()) {
                    report.warnings.push_back("Table unit '" + u.id + "' row '" + r.row_id + "' has no cells.");
                }
            }
        }

        // Check Image integrity
        if (u.image_data.has_value()) {
            const auto& img = u.image_data.value();
            if (img.width_pt <= 0 || img.height_pt <= 0) {
                report.warnings.push_back("Image unit '" + u.id + "' has non-positive dimensions.");
            }
        }
    }

    // 2. Verify Rav-Text Links
    for (const auto& kv : links_) {
        const auto& link = kv.second;
        if (units_.find(link.source_unit_id) == units_.end()) {
            report.passed = false;
            report.errors.push_back("Rav-Text link '" + link.link_id + "' references missing source unit '" + link.source_unit_id + "'.");
        }
        if (units_.find(link.commentary_unit_id) == units_.end()) {
            report.passed = false;
            report.errors.push_back("Rav-Text link '" + link.link_id + "' references missing commentary unit '" + link.commentary_unit_id + "'.");
        }
    }

    return report;
}

} // namespace keter
