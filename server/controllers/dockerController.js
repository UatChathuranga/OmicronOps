import * as DockerModel from '../models/dockerModel.js';

export async function getDockerStatus(req, res) {
  const { connectionId } = req.query;
  if (!connectionId) {
    return res.status(400).json({ error: 'connectionId is required' });
  }
  try {
    const data = await DockerModel.getDockerStatus(connectionId);
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function handleAgentDockerStatus(connectionId, data) {
  try {
    await DockerModel.saveDockerStatus(connectionId, data.installed, data.list);
  } catch (err) {
    console.error(`[DockerController] Failed to save agent docker status for ${connectionId}:`, err);
  }
}
