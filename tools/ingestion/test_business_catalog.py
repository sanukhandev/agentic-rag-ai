import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

try:
    from openpyxl import Workbook
    from ingestion.business_catalog import BusinessCatalogParseError, REQUIRED_SHEETS, parse_business_catalog
    from ingestion.worker import process_job, business_catalog_result_payload
except ModuleNotFoundError:  # pragma: no cover - environment dependency gate
    Workbook = None


class BusinessCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        if Workbook is None:
            self.skipTest("openpyxl is not installed")

    def workbook(self, directory: str) -> Path:
        path = Path(directory) / "catalog-published.xlsx"
        workbook = Workbook()
        workbook.active.title = "README"
        headers = {
            "README": ["key", "value"],
            "CatalogManifest": ["schema_version", "catalog_key", "tenant_scope", "revision", "policy_version"],
            "BusinessGoals": ["business_goal_key", "name", "description", "keywords", "customer_expressions", "required_information", "required_documents", "ordered_steps", "package_references", "product_references", "authorized_tool_keys", "completion_conditions", "active", "confirmation_required", "completion_policy_key"],
            "IntentCategories": ["category_key", "name", "active"],
            "TurnIntents": ["turn_intent_key", "category_key", "business_goal_key", "active"],
            "IntentSignals": ["signal_id", "target_key", "signal_type", "value", "language", "weight", "min_weight", "max_weight"],
            "ScoringPolicies": ["scoring_policy_key", "business_goal_key", "threshold", "ambiguity_margin", "policy_version"],
            "RequirementPolicies": ["requirement_key", "goal_key", "stage_key", "type", "required", "dependencies", "validation", "source_of_truth", "prompt_key", "priority"],
            "BusinessStages": ["business_goal_key", "stage_key", "stage_order", "entry_requirements", "completion_evidence_policy_key", "active"],
            "ToolBindings": ["tool_key", "goal_key", "stage_key", "side_effect_class", "arguments_schema_ref", "required_keys", "consent", "confirmation", "registry_key", "enabled"],
            "WorkflowBindings": ["workflow_key", "registry_key", "provider_type", "payload_schema_ref", "callback_schema_ref", "evidence_policy_key", "n8n_workflow_id", "webhook_path", "payload_contract", "enabled"],
            "FollowUpPolicies": ["policy_key", "goal_key", "stage_key", "requirement_key", "priority", "no_question_reasons"],
            "KnowledgeTopics": ["topic_key", "goal_key", "source_scope", "citation_required", "active"],
            "PersonaPolicies": ["persona_policy_key", "persona_version_id", "permitted_languages", "fallback_template_ref", "enabled"],
            "DocumentPolicies": ["policy_key", "goal_key", "stage_key", "doc_type", "required", "mime_types", "review_policy", "retention_class", "enabled"],
        }
        for name in REQUIRED_SHEETS:
            sheet = workbook[name] if name == "README" else workbook.create_sheet(name)
            sheet.append(headers[name])
        workbook["CatalogManifest"].append([2, "ancfz", "ancfz", 1, "ancfz-published"])
        workbook.save(path)
        return path

    def test_valid_workbook_is_hash_bound_and_lossless(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parsed = parse_business_catalog(self.workbook(directory), "ancfz")
            self.assertEqual(parsed["schemaVersion"], 2)
            self.assertEqual(parsed["manifest"]["catalogKey"], "ancfz")
            self.assertEqual(len(parsed["sourceHash"]), 64)

    def test_published_payload_matches_node_required_catalog_envelope(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parsed = parse_business_catalog(self.workbook(directory), "ancfz")
            payload = business_catalog_result_payload(parsed)
            self.assertEqual(set(payload), {"sourceHash", "parserVersion", "catalog"})
            self.assertEqual(set(payload["catalog"]), {"schemaVersion", "manifest", "sheets"})
            self.assertEqual(payload["catalog"]["schemaVersion"], 2)
            self.assertEqual(payload["catalog"]["manifest"]["tenantScope"], "ancfz")
            self.assertEqual(payload["sourceHash"], parsed["sourceHash"])
            self.assertEqual(payload["parserVersion"], parsed["parserVersion"])

    def test_worker_posts_valid_published_envelope_without_changing_v1_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workbook_content = self.workbook(directory).read_bytes()
            with patch("ingestion.worker.fetch_job_input", return_value=(
                "catalog-published.xlsx", "application/vnd.agentic.intent-catalog+excel", workbook_content
            )), patch("ingestion.worker.submit_catalog_result", return_value={"job": {"status": "completed"}}) as submit:
                result = process_job(
                    "http://api:4000", "test-job", "test-secret",
                    staging_root=Path(directory) / "staging",
                    session=Mock(), already_claimed=True,
                )
            self.assertEqual(result["job"]["status"], "completed")
            posted = submit.call_args.args[3]
            self.assertIn("catalog", posted)
            self.assertEqual(posted["catalog"]["schemaVersion"], 2)
            self.assertIn("CatalogManifest", posted["catalog"]["sheets"])
            self.assertEqual(set(posted), {"sourceHash", "parserVersion", "catalog"})

    def test_rejects_v1_unknown_sheet_and_scope_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.workbook(directory)
            workbook = __import__("openpyxl").load_workbook(path)
            workbook["CatalogManifest"]["A2"] = 1
            workbook.create_sheet("Intents")
            workbook.save(path)
            with self.assertRaises(BusinessCatalogParseError):
                parse_business_catalog(path)
            self.workbook(directory)
            with self.assertRaises(BusinessCatalogParseError) as error:
                parse_business_catalog(path, "other-tenant")
            self.assertEqual(error.exception.code, "TENANT_SCOPE_MISMATCH")

    def test_rejects_formula_and_bad_json_array(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.workbook(directory)
            workbook = __import__("openpyxl").load_workbook(path)
            workbook["BusinessStages"].append(["ancfz", "lead_generation", 1, "not-json", "evidence", True])
            workbook.save(path)
            with self.assertRaises(BusinessCatalogParseError) as error:
                parse_business_catalog(path)
            self.assertIn(error.exception.code, {"INVALID_JSON_ARRAY", "FORMULA_NOT_ALLOWED"})
            self.workbook(directory)
            workbook = __import__("openpyxl").load_workbook(path)
            workbook["BusinessStages"]["D2"] = "=SUM(1,1)"
            workbook.save(path)
            with self.assertRaises(BusinessCatalogParseError) as error:
                parse_business_catalog(path)
            self.assertEqual(error.exception.code, "FORMULA_NOT_ALLOWED")


if __name__ == "__main__":
    unittest.main()
