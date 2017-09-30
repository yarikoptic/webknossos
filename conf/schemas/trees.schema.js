db.runCommand({
  collMod: "trees",
  validator: {
    $and: [
      {
        _tracing: { $type: "objectId", $exists: true },
      },
      {
        treeId: { $type: "number", $exists: true },
      },
      {
        $or: [{ color: { $type: "array" } }, { color: { $exists: false } }],
      },
      {
        branchPoints: { $type: "array", $exists: true },
      },
      {
        comments: { $type: "array", $exists: true },
      },
      {
        timestamp: { $type: "number", $exists: true },
      },
      {
        name: { $type: "string", $exists: true },
      },
      {
        _id: { $type: "objectId", $exists: true },
      },
    ],
  },
});
