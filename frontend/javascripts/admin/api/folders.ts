import Request from "libs/request";
import { Folder, FlatFolderTreeItem } from "types/api_flow_types";

export function getFolderTree(): Promise<FlatFolderTreeItem[]> {
  return Request.receiveJSON("/api/folders/tree");
}

export async function createFolder(parentId: string, name: string): Promise<Folder> {
  const params = new URLSearchParams();
  params.append("parentId", parentId);
  params.append("name", name);

  const folder = await Request.receiveJSON(`/api/folders/create?${params}`, {
    method: "POST",
  });
  folder.parent = parentId;
  return folder;
}

export async function deleteFolder(id: string): Promise<string> {
  await Request.receiveJSON(`/api/folders/${id}`, {
    method: "DELETE",
  });
  // Return deleted id
  return id;
}

export function updateFolder(folder: Folder): Promise<Folder> {
  return Request.sendJSONReceiveJSON(`/api/folders/${folder.id}`, {
    data: folder,
    method: "PUT",
  });
}