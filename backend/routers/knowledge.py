"""Self knowledge base — dictate notes about the app under test, organized by
an LLM and stored as queryable markdown. A reference library (not auto-fed to
the agent)."""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.knowledge import add_note, delete_note, get_note, search_notes, update_note

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class NoteOut(BaseModel):
    id: str
    title: str
    body: str = ""
    keywords: list[str] = []
    aliases: list[str] = []
    raw_input: str = ""
    created_at: str = ""
    updated_at: str = ""


class NoteIn(BaseModel):
    text: str


class NotePatch(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    keywords: Optional[list[str]] = None
    aliases: Optional[list[str]] = None


@router.get("", response_model=list[NoteOut])
async def list_knowledge(q: str = ""):
    return search_notes(q)


@router.post("", response_model=NoteOut, status_code=201)
async def create_knowledge(body: NoteIn):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty note")
    return await add_note(text)


@router.get("/{note_id}", response_model=NoteOut)
async def read_knowledge(note_id: str):
    note = get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.put("/{note_id}", response_model=NoteOut)
async def edit_knowledge(note_id: str, body: NotePatch):
    note = update_note(note_id, body.model_dump(exclude_unset=True))
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.delete("/{note_id}", status_code=204)
async def remove_knowledge(note_id: str):
    if not delete_note(note_id):
        raise HTTPException(status_code=404, detail="Note not found")
