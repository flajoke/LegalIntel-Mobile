from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.dependencies import get_letter_service
from app.api.document_schemas import DocumentDraftRequest, DocumentDraftResponse, DocumentExportRequest
from app.api.schemas import ErrorResponse
from app.application.letter_service import LetterService
from app.domain.cases.salary_delay import CaseInputError
from app.infrastructure.documents.exporter import MIME, export_document
from app.api.auth import current_user

router = APIRouter(prefix="/api/v1/salary-delay/documents", tags=["documents"], dependencies=[Depends(current_user)])


@router.post("/draft", response_model=DocumentDraftResponse, responses={422: {"model": ErrorResponse}},
             summary="Подготовить редактируемый черновик без LLM и отправки")
def document_draft(payload: DocumentDraftRequest, request: Request,
                   service: Annotated[LetterService, Depends(get_letter_service)]):
    try:
        result = service.draft(payload.state.model_dump(), payload.details.model_dump(), payload.template, payload.analysis_options.model_dump())
    except CaseInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {**result, "conversation_id": payload.conversation_id, "document_id": payload.document_id,
            "template": payload.template, "request_id": request.state.request_id}


@router.post("/export", response_class=Response,
             responses={200: {"description": "Файл по выбранному формату", "content": {MIME["pdf"]: {}, MIME["docx"]: {}}}, 422: {"model": ErrorResponse}},
             summary="Экспорт проверенного пользователем текста в PDF или DOCX")
def document_export(payload: DocumentExportRequest):
    try:
        content = export_document(payload.text, payload.format)
    except CaseInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    filename = f"legalintel-{payload.template}-{payload.document_id}.{payload.format}"
    return Response(content, media_type=MIME[payload.format], headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Content-Type-Options": "nosniff"})
