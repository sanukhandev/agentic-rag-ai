from ingestion.document_ocr import document_summary, extract_document_text


def test_text_document_extraction_and_summary_are_deterministic() -> None:
    text = extract_document_text("requirements.txt", "text/plain", b"Company setup\n\nNeed two visas")
    assert text == "Company setup\n\nNeed two visas"
    assert document_summary(text, "requirements.txt").startswith("OCR extracted business-document text from requirements.txt:")
