"""CRUD for Project Profiles (external KB / skills / source pointers)."""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.projects import load_projects, new_project, save_projects

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectOut(BaseModel):
    id: str
    name: str
    app_package: str = ""
    kb_path: str = ""
    skills_path: str = ""
    source_root: str = ""
    kb_search_cmd: str = ""


class ProjectIn(BaseModel):
    name: str = ""
    app_package: str = ""
    kb_path: str = ""
    skills_path: str = ""
    source_root: str = ""
    kb_search_cmd: str = ""


@router.get("", response_model=list[ProjectOut])
async def list_projects():
    return load_projects()


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(body: ProjectIn):
    projects = load_projects()
    proj = new_project(body.model_dump())
    projects.append(proj)
    save_projects(projects)
    return proj


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, body: ProjectIn):
    projects = load_projects()
    for p in projects:
        if p["id"] == project_id:
            p.update({k: (v or "").strip() for k, v in body.model_dump().items()})
            save_projects(projects)
            return p
    raise HTTPException(status_code=404, detail="Project not found")


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str):
    projects = load_projects()
    remaining = [p for p in projects if p["id"] != project_id]
    if len(remaining) == len(projects):
        raise HTTPException(status_code=404, detail="Project not found")
    save_projects(remaining)
