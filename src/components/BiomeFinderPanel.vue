<script setup lang="ts">
import { computed, inject } from 'vue';
import { Identifier } from 'deepslate';
import { useBiomeFinderStore } from '../stores/useBiomeFinderStore';
import { useLoadedDimensionStore } from '../stores/useLoadedDimensionStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useI18n } from 'vue-i18n';

const i18n = useI18n()
const biomeFinderStore = useBiomeFinderStore()
const loadedDimensionStore = useLoadedDimensionStore()
const settingsStore = useSettingsStore()

// Inject navigation function from MainMap
const navigateToBiome = inject<(x: number, z: number) => void>('navigateToBiome')

// Sort biomes by distance
const sortedBiomes = computed(() => {
	const entries = Array.from(biomeFinderStore.biomeLocations.entries())
	return entries.sort((a, b) => a[1].distance - b[1].distance)
})

function startSearch() {
	biomeFinderStore.startSearch()
}

function handleBiomeClick(x: number, z: number) {
	if (navigateToBiome) {
		navigateToBiome(x, z)
	}
}

function getBiomeColorStyle(biomeId: string) {
	const color = loadedDimensionStore.getBiomeColor(biomeId)
	return {
		backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})`
	}
}
</script>

<template>
	<div class="biome-finder-panel">
		<div class="panel-header">
			<h3>{{ i18n.t('biome_finder.title', 'Biome Explorer') }}</h3>
		</div>

		<button
			class="search-button"
			@click="startSearch"
			:disabled="biomeFinderStore.isSearching"
		>
			<font-awesome-icon v-if="biomeFinderStore.isSearching" icon="fa-spinner" spin />
			<font-awesome-icon v-else icon="fa-search" />
			{{ biomeFinderStore.isSearching ? i18n.t('biome_finder.searching', 'Searching...') : i18n.t('biome_finder.start_search', 'Find All Biomes') }}
		</button>

		<div v-if="biomeFinderStore.isSearching" class="progress-container">
			<div class="progress-bar">
				<div class="progress-fill" :style="{ width: biomeFinderStore.progress + '%' }"></div>
			</div>
			<div class="progress-text">
				{{ biomeFinderStore.totalFound }} / {{ biomeFinderStore.totalExpected }} {{ i18n.t('biome_finder.biomes_found', 'biomes found') }}
			</div>
		</div>

		<div v-if="biomeFinderStore.allBiomesFound && !biomeFinderStore.isSearching" class="completion-message">
			<font-awesome-icon icon="fa-check-circle" />
			{{ i18n.t('biome_finder.all_found', 'All biomes found!') }}
		</div>

		<div v-if="sortedBiomes.length > 0" class="biome-list">
			<div
				v-for="[biomeId, location] in sortedBiomes"
				:key="biomeId"
				class="biome-entry"
				@click="handleBiomeClick(location.x, location.z)"
			>
				<div class="biome-color" :style="getBiomeColorStyle(biomeId)"></div>
				<div class="biome-info">
					<div class="biome-name">{{ settingsStore.getLocalizedName('biome', Identifier.parse(biomeId), false) }}</div>
					<div class="biome-distance">{{ Math.round(location.distance) }}m</div>
				</div>
			</div>
		</div>

		<div v-if="!biomeFinderStore.isSearching && sortedBiomes.length === 0" class="empty-state">
			{{ i18n.t('biome_finder.no_results', 'Click "Find All Biomes" to start exploring') }}
		</div>
	</div>
</template>

<style scoped>
.biome-finder-panel {
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.panel-header h3 {
	margin: 0;
	font-size: 1.1rem;
	font-weight: 600;
}

.search-button {
	width: 100%;
	height: 2.5rem;
	background-color: rgb(55, 120, 173);
	color: white;
	border: none;
	border-radius: 0.3rem;
	cursor: pointer;
	font-size: 1rem;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	transition: background-color 0.2s;
}

.search-button:hover:not(:disabled) {
	background-color: rgb(70, 140, 200);
}

.search-button:disabled {
	cursor: not-allowed;
	opacity: 0.7;
}

.progress-container {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.progress-bar {
	width: 100%;
	height: 1.5rem;
	background-color: rgba(255, 255, 255, 0.1);
	border-radius: 0.3rem;
	overflow: hidden;
}

.progress-fill {
	height: 100%;
	background-color: rgb(55, 120, 173);
	transition: width 0.3s ease;
}

.progress-text {
	text-align: center;
	font-size: 0.9rem;
	color: rgba(255, 255, 255, 0.8);
}

.completion-message {
	padding: 0.5rem;
	background-color: rgba(76, 175, 80, 0.2);
	border-radius: 0.3rem;
	color: rgb(144, 238, 144);
	text-align: center;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
}

.biome-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	max-height: 400px;
	overflow-y: auto;
}

.biome-entry {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.5rem;
	background-color: rgba(255, 255, 255, 0.05);
	border-radius: 0.3rem;
	cursor: pointer;
	transition: background-color 0.2s;
}

.biome-entry:hover {
	background-color: rgba(255, 255, 255, 0.1);
}

.biome-color {
	width: 2rem;
	height: 2rem;
	border-radius: 0.2rem;
	flex-shrink: 0;
}

.biome-info {
	flex-grow: 1;
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}

.biome-name {
	font-size: 0.9rem;
	font-weight: 500;
}

.biome-distance {
	font-size: 0.8rem;
	color: rgba(255, 255, 255, 0.6);
}

.empty-state {
	padding: 1rem;
	text-align: center;
	color: rgba(255, 255, 255, 0.5);
	font-size: 0.9rem;
}

.biome-list::-webkit-scrollbar {
	width: 8px;
}

.biome-list::-webkit-scrollbar-track {
	background: rgba(255, 255, 255, 0.05);
	border-radius: 4px;
}

.biome-list::-webkit-scrollbar-thumb {
	background: rgba(255, 255, 255, 0.2);
	border-radius: 4px;
}

.biome-list::-webkit-scrollbar-thumb:hover {
	background: rgba(255, 255, 255, 0.3);
}
</style>
