from html import escape
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from threading import Lock

from app.domain.cases.salary_delay import CaseInputError
from app.domain.letters import TITLES, validate_export

MIME = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
FONT_DIR = Path(__file__).resolve().parent / "fonts"
FONT_LOCK = Lock()
HEADER_PREFIXES = ("Кому:", "Адрес:", "От:", "Почтовый адрес:", "Контактные данные:")


def _paragraphs(text):
    # Keep user edits and line breaks; group wrapped paragraphs only at explicit blanks.
    return text.split("\n")


def export_document(text: str, format: str) -> bytes:
    text = validate_export(text)
    if format == "pdf": return _pdf(text)
    if format == "docx": return _docx(text)
    raise CaseInputError("Выберите PDF или DOCX.")


def _docx(text):
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Mm, Pt, RGBColor
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    section.top_margin = section.bottom_margin = Mm(20)
    section.left_margin, section.right_margin = Mm(25), Mm(20)
    normal = document.styles["Normal"]
    normal.font.name, normal.font.size = "Times New Roman", Pt(12)
    normal.font.color.rgb = RGBColor(0, 0, 0)
    normal.paragraph_format.line_spacing = 1.2
    normal.paragraph_format.space_after = Pt(4)
    title = document.styles["Title"]
    title.font.name, title.font.size, title.font.bold = "Times New Roman", Pt(14), True
    title.font.color.rgb = RGBColor(0, 0, 0)
    title.paragraph_format.keep_with_next = True
    title.paragraph_format.space_before, title.paragraph_format.space_after = Pt(10), Pt(10)
    header = True
    for line in _paragraphs(text):
        if not line.strip():
            header = False
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(3)
            paragraph.paragraph_format.line_spacing = 0.5
            paragraph.add_run().font.size = Pt(4)
            continue
        is_title = line in TITLES.values()
        if header and not line.startswith(HEADER_PREFIXES): header = False
        paragraph = document.add_paragraph(line, style="Title" if is_title else "Normal")
        paragraph.paragraph_format.widow_control = True
        if line.startswith("Дата:"): paragraph.paragraph_format.keep_with_next = True
        if is_title: paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif header: paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    document.core_properties.author = ""
    document.core_properties.last_modified_by = ""
    document.core_properties.title = "Обращение по вопросу выплаты"
    document.core_properties.subject = ""
    document.core_properties.comments = ""
    document.core_properties.created = document.core_properties.modified = datetime.now(timezone.utc)
    stream = BytesIO()
    document.save(stream)
    return stream.getvalue()


def _pdf(text):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    with FONT_LOCK:
        if "LegalIntelSans" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("LegalIntelSans", str(FONT_DIR / "DejaVuSans.ttf")))
            pdfmetrics.registerFont(TTFont("LegalIntelSansBold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
    supported = pdfmetrics.getFont("LegalIntelSans").face.charToGlyph
    if any(ord(char) not in supported for char in text if not char.isspace()):
        raise CaseInputError("В тексте есть символы, не поддерживаемые шрифтом PDF. Замените необычные символы или используйте DOCX.")
    stream = BytesIO()
    doc = SimpleDocTemplate(stream, pagesize=A4, leftMargin=25*mm, rightMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm,
                            title="Обращение по вопросу выплаты", author="")
    body = ParagraphStyle("Body", fontName="LegalIntelSans", fontSize=10.5, leading=15, textColor=colors.black,
                          spaceAfter=5, alignment=TA_LEFT, splitLongWords=True, allowWidows=0, allowOrphans=0)
    title = ParagraphStyle("Title", parent=body, fontName="LegalIntelSansBold", fontSize=12, leading=17,
                           spaceBefore=8, spaceAfter=12, alignment=TA_CENTER, keepWithNext=True)
    head = ParagraphStyle("Address", parent=body, alignment=TA_RIGHT)
    signature_date = ParagraphStyle("SignatureDate", parent=body, keepWithNext=True)
    story, header = [], True
    for line in _paragraphs(text):
        if not line.strip():
            header = False
            story.append(Spacer(1, 5))
        else:
            if header and not line.startswith(HEADER_PREFIXES): header = False
            style = title if line in TITLES.values() else head if header else signature_date if line.startswith("Дата:") else body
            story.append(Paragraph(escape(line).replace("\t", "    "), style))
    doc.build(story)
    return stream.getvalue()
