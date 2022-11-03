import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDatasets, updateDataset } from "admin/admin_rest_api";
import { createFolder, deleteFolder, getFolderTree, updateFolder } from "admin/api/folders";
import { Menu, Dropdown } from "antd";
import Toast from "libs/toast";
import { DatasetExtentRow } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import { GenerateNodePropsType } from "oxalis/view/right-border-tabs/tree_hierarchy_view";
import React, { useContext, useEffect, useState } from "react";
import { DropTargetMonitor, useDrop } from "react-dnd";
import SortableTree, { ExtendedNodeData } from "react-sortable-tree";
// @ts-ignore
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { APIDataset, APIUser, Folder, FlatFolderTreeItem } from "types/api_flow_types";
import { DraggableType, TeamTags } from "./advanced_dataset/dataset_table";
import { DatasetCacheContext } from "./dataset/dataset_cache_provider";
import DatasetView from "./dataset_view";

function useFolderTreeQuery() {
  return useQuery(["folders"], getFolderTree, {
    refetchOnWindowFocus: false,
  });
}

function useDatasetsInFolder(folderId: string) {
  return useQuery(["datasets", folderId], ({ queryKey }) => getDatasets(false, queryKey[1]), {
    refetchOnWindowFocus: false,
  });
}

function useCreateFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation(([parentId, name]: [string, string]) => createFolder(parentId, name), {
    mutationKey,
    onSuccess: (newFolder) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).concat([newFolder]),
      );
    },
    onError: (err) => {
      Toast.error(`Could not create folder. ${err}`);
    },
  });
}

function useDeleteFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation((id: string) => deleteFolder(id), {
    mutationKey,
    onSuccess: (deletedId) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).filter((folder: Folder) => folder.id !== deletedId),
      );
    },
    onError: (err) => {
      Toast.error(`Could not delete folder. ${err}`);
    },
  });
}

function useUpdateFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation((folder: Folder) => updateFolder(folder), {
    mutationKey,
    onSuccess: (updatedFolder) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).map((oldFolder: Folder) =>
          oldFolder.id === updatedFolder.id
            ? {
                ...updatedFolder,
                // @ts-ignore todo: clean this up
                parent: oldFolder.parent,
              }
            : oldFolder,
        ),
      );
    },
    onError: (err) => {
      Toast.error(`Could not update folder. ${err}`);
    },
  });
}

type Props = {
  user: APIUser;
};
export function DatasetFolderView(props: Props) {
  const [selectedDataset, setSelectedDataset] = useState<APIDataset | null>(null);

  return (
    <div style={{ display: "grid", gridTemplate: "auto 1fr auto / auto 1fr auto" }}>
      <div style={{ gridColumn: "1 / 2", overflow: "auto" }}>
        <FolderSidebar />
      </div>
      <main style={{ gridColumn: "2 / 2", overflow: "auto" }}>
        <DatasetView
          user={props.user}
          onSelectDataset={setSelectedDataset}
          selectedDataset={selectedDataset}
        />
      </main>
      <div style={{ gridColumn: "3 / 4", overflow: "auto" }}>
        <DatasetDetailsSidebar selectedDataset={selectedDataset} />
      </div>
    </div>
  );
}

function DatasetDetailsSidebar({ selectedDataset }: { selectedDataset: APIDataset | null }) {
  // allowedTeams: Array<APITeam>;
  // created: number;
  // description: string | null | undefined;
  // isPublic: boolean;

  // owningOrganization: string;
  // publication: null | undefined;
  // tags: Array<string>;

  return (
    <div style={{ width: 300, padding: 16 }}>
      {selectedDataset != null ? (
        <>
          <h1 style={{ wordBreak: "break-all" }}>
            {selectedDataset.displayName || selectedDataset.name}
          </h1>
          Description: {selectedDataset.description}
          <div className="info-tab-block">
            <table
              style={{
                fontSize: 14,
              }}
            >
              <tbody>
                <DatasetExtentRow dataset={selectedDataset} />
              </tbody>
            </table>
          </div>
          Access Permissions:
          <TeamTags dataset={selectedDataset} />
        </>
      ) : (
        "No dataset selected"
      )}
    </div>
  );
}

type FolderItem = {
  title: string;
  id: string;
  expanded?: boolean;
  children: FolderItem[];
};

type State = {
  treeData: FolderItem[];
};

function generateNodeProps(
  createFolderMutation: ReturnType<typeof useCreateFolderMutation>,
  updateFolderMutation: ReturnType<typeof useUpdateFolderMutation>,
  deleteFolderMutation: ReturnType<typeof useDeleteFolderMutation>,
  params: ExtendedNodeData<FolderItem>,
): GenerateNodePropsType {
  const { node } = params;
  const { id, title } = node;
  const nodeProps: GenerateNodePropsType = {};

  function createFolder(): void {
    const folderName = prompt("Please input a name for the new folder");
    createFolderMutation.mutateAsync([id, folderName || "New folder"]);
  }
  function deleteFolder(): void {
    deleteFolderMutation.mutateAsync(id);
  }
  function renameFolder(): void {
    const folderName = prompt("Please input a new name for the folder");
    updateFolderMutation.mutateAsync({
      name: folderName || "New folder",
      id,
      teams: [], // todo
    });
  }

  const createMenu = () => (
    <Menu>
      <Menu.Item key="create" data-group-id={id} onClick={createFolder}>
        <PlusOutlined />
        New Folder
      </Menu.Item>
      <Menu.Item key="rename" data-group-id={id} onClick={renameFolder}>
        <PlusOutlined />
        Rename Folder
      </Menu.Item>
      <Menu.Item key="delete" data-group-id={id} onClick={deleteFolder}>
        <DeleteOutlined />
        Delete Folder
      </Menu.Item>
    </Menu>
  );

  nodeProps.title = (
    <div>
      <Dropdown
        overlay={createMenu}
        placement="bottom"
        // The overlay is generated lazily. By default, this would make the overlay
        // re-render on each parent's render() after it was shown for the first time.
        // The reason for this is that it's not destroyed after closing.
        // Therefore, autoDestroy is passed.
        // destroyPopupOnHide should also be an option according to the docs, but
        // does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; overlay: () => Element;... Remove this comment to see the full error message
        autoDestroy
        trigger={["contextMenu"]}
      >
        <FolderItemAsDropTarget folderId={id}>{title}</FolderItemAsDropTarget>
      </Dropdown>
    </div>
  );

  return nodeProps;
}

function FolderItemAsDropTarget(props: { folderId: string; children: React.ReactNode }) {
  const context = useContext(DatasetCacheContext);
  const { folderId } = props;

  const [collectedProps, drop] = useDrop({
    accept: DraggableType,
    drop: (item) => {
      console.log(item);

      const dataset = context.datasets.find((dataset) => dataset.name === item.datasetName);

      if (dataset) {
        updateDataset(dataset, dataset, folderId);
      }

      console.log("dataset", dataset);
    },
    collect: (monitor: DropTargetMonitor) => {
      return {
        canDrop: monitor.canDrop(),
        isOver: monitor.isOver(),
      };
    },
  });
  const { canDrop, isOver } = collectedProps;
  return (
    <div className={`folder-item ${isOver && canDrop ? "valid-drop-target" : ""}`} ref={drop}>
      {props.children}
    </div>
  );
}

function FolderSidebar() {
  const [state, setState] = useState<State>({
    treeData: [],
  });
  const [currentFolderId, setCurrentFolderId] = useState("6362711c1d02000d044590dc");
  const { error, data: folderTree, isLoading } = useFolderTreeQuery();

  useEffect(() => {
    setState((prevState: State) => {
      const treeData = getFolderHierarchy(folderTree, prevState.treeData);
      return { treeData: treeData };
    });
  }, [folderTree]);

  const { data: datasets } = useDatasetsInFolder(currentFolderId);
  console.log("datasets", datasets);

  const createFolderMutation = useCreateFolderMutation();
  const deleteFolderMutation = useDeleteFolderMutation();
  const updateFolderMutation = useUpdateFolderMutation();

  const [canDrop, drop] = useDrop({
    accept: DraggableType,
    collect: (monitor: DropTargetMonitor) => {
      return monitor.canDrop();
    },
  });
  return (
    <div
      ref={drop}
      className={canDrop ? "highlight-folder-sidebar" : undefined}
      style={{
        height: 400,
        width: 250,
        marginRight: 4,
        borderRadius: 2,
        padding: 2,
      }}
    >
      <SortableTree
        treeData={state.treeData}
        onChange={(treeData) => setState({ treeData })}
        theme={FileExplorerTheme}
        canDrag={false}
        generateNodeProps={(params) =>
          generateNodeProps(
            createFolderMutation,
            updateFolderMutation,
            deleteFolderMutation,
            params,
          )
        }
      />
    </div>
  );
}

function getFolderHierarchy(
  folderTree: FlatFolderTreeItem[] | undefined,
  prevFolderItems: FolderItem[] | null,
): FolderItem[] {
  if (folderTree == null) {
    return [];
  }
  const roots: FolderItem[] = [];
  const itemById: Record<string, FolderItem> = {};
  for (const folderTreeItem of folderTree) {
    const treeItem = {
      id: folderTreeItem.id,
      title: folderTreeItem.name,
      children: [],
    };
    if (folderTreeItem.parent == null) {
      roots.push(treeItem);
    }
    itemById[folderTreeItem.id] = treeItem;
  }

  for (const folderTreeItem of folderTree) {
    if (folderTreeItem.parent != null) {
      itemById[folderTreeItem.parent].children.push(itemById[folderTreeItem.id]);
    }
  }

  if (roots.length === 1) {
    roots[0].expanded = true;
  }

  // Copy the expanded flags from the old state
  forEachFolderItem(prevFolderItems || [], (item: FolderItem) => {
    const maybeItem = itemById[item.id];
    if (maybeItem != null) {
      maybeItem.expanded = item.expanded;
    }
  });

  return roots;
}

function forEachFolderItem(roots: FolderItem[], fn: (item: FolderItem) => void) {
  for (const item of roots) {
    fn(item);
    forEachFolderItem(item.children, fn);
  }
}
