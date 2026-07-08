/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registry for cluster-specific command panel components.
 * Components register themselves by cluster ID and are dynamically
 * rendered in the cluster view when viewing that cluster.
 */

const clusterCommandRegistry = new Map<number, string>();

/**
 * Register a cluster command panel component.
 * @param clusterId - The Matter cluster ID (e.g., 6 for OnOff, 8 for LevelControl)
 * @param tagName - The custom element tag name (e.g., "on-off-cluster-commands")
 */
export function registerClusterCommands(clusterId: number, tagName: string): void {
    clusterCommandRegistry.set(clusterId, tagName);
}

/**
 * Get the registered component tag name for a cluster ID.
 * @param clusterId - The Matter cluster ID
 * @returns The custom element tag name, or undefined if not registered
 */
export function getClusterCommandsTag(clusterId: number): string | undefined {
    return clusterCommandRegistry.get(clusterId);
}

/**
 * Check if a cluster has a registered command panel.
 * @param clusterId - The Matter cluster ID
 * @returns true if a command panel is registered
 */
export function hasClusterCommands(clusterId: number): boolean {
    return clusterCommandRegistry.has(clusterId);
}
