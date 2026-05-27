<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { Identifier } from 'deepslate';
import { useBiomeFinderStore } from '../stores/useBiomeFinderStore';
import { useLoadedDimensionStore } from '../stores/useLoadedDimensionStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useI18n } from 'vue-i18n';

const i18n = useI18n()
const biomeFinderStore = useBiomeFinderStore()
const loadedDimensionStore = useLoadedDimensionStore()
const settingsStore = useSettingsStore()

const RADIUS_MIN = 100
const RADIUS_MAX = 20000
const radiusError = ref('')

// Inject navigation function from MainMap
const navigateToBiome = inject<(x: number, z: number) => void>('navigateToBiome')

// Sort biomes by distance
const sortedBiomes = computed(() => {
	const entries = Array.from(biomeFinderStore.biomeLocations.entries())
	return entries.sort((a, b) => a[1].distance - b[1].distance)
})

function startSearch() {
	const r = biomeFinderStore.searchRadius
	if (!Number.isFinite(r) || !Number.isInteger(r)) {
		radiusError.value = i18n.t('biome_finder.error_invalid', 'Please enter a valid number.')
		return
	}
	if (r < RADIUS_MIN || r > RADIUS_MAX) {
		radiusError.value = i18n.t('biome_finder.error_range', `Enter a value between ${RADIUS_MIN} and ${RADIUS_MAX}.`, { min: RADIUS_MIN, max: RADIUS_MAX })
		return
	}
	radiusError.value = ''
	biomeFinderStore.startSearch()
}

function cancelSearch() {
	biomeFinderStore.cancelSearch()
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

		<div class="radius-row">
			<input
				type="number"
				class="radius-input"
				:class="{ 'input-error': radiusError }"
				v-model.number="biomeFinderStore.searchRadius"
				:disabled="biomeFinderStore.isSearching"
				min="100"
				max="20000"
				step="100"
			/>
			<span class="radius-label">blocks (±coord)</span>
		</div>
		<div v-if="radiusError" class="radius-error">{{ radiusError }}</div>

		<div class="button-row">
			<button
				class="search-button"
				@click="startSearch"
				:disabled="biomeFinderStore.isSearching"
			>
				<font-awesome-icon v-if="biomeFinderStore.isSearching" icon="fa-spinner" spin />
				<font-awesome-icon v-else icon="fa-magnifying-glass" />
				{{ biomeFinderStore.isSearching ? i18n.t('biome_finder.searching', 'Searching...') : i18n.t('biome_finder.start_search', 'Find All Biomes') }}
			</button>
			<button
				v-if="biomeFinderStore.isSearching"
				class="cancel-button"
				@click="cancelSearch"
			>
				<font-awesome-icon icon="fa-xmark" />
			</button>
		</div>

		<div v-if="biomeFinderStore.isSearching" class="progress-container">
			<div class="progress-bar">
				<div class="progress-fill" :style="{ width: biomeFinderStore.progress + '%' }"></div>
			</div>
			<div class="progress-text">
				{{ biomeFinderStore.totalFound }} / {{ biomeFinderStore.totalExpected }} {{ i18n.t('biome_finder.biomes_found', 'biomes found') }}
			</div>
		</div>

		<div v-if="!biomeFinderStore.isSearching && biomeFinderStore.searchedRadius > 0" class="completion-message" :class="{ 'partial': !biomeFinderStore.allBiomesFound }">
			<font-awesome-icon :icon="biomeFinderStore.allBiomesFound ? 'fa-circle-check' : 'fa-circle-info'" />
			<span v-if="biomeFinderStore.allBiomesFound">
				{{ biomeFinderStore.totalFound }} {{ i18n.t('biome_finder.all_found', 'biomes found within ±') }}{{ biomeFinderStore.searchedRadius.toLocaleString() }} blocks
			</span>
			<span v-else>
				{{ biomeFinderStore.totalFound }} / {{ biomeFinderStore.totalExpected }} {{ i18n.t('biome_finder.partial_found', 'biomes found (searched ±') }}{{ biomeFinderStore.searchedRadius.toLocaleString() }} blocks)
			</span>
		</div>

		<div v-if="sortedBiomes.length > 0" class="biome-section">
			<div class="section-header">
				{{ i18n.t('biome_finder.found_biomes', 'Found') }} ({{ sortedBiomes.length }})
			</div>
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

		<div v-if="!biomeFinderStore.isSearching && biomeFinderStore.missingBiomes.length > 0" class="biome-section">
			<div class="section-header">
				{{ i18n.t('biome_finder.missing_biomes', 'Not found') }} ({{ biomeFinderStore.missingBiomes.length }})
			</div>
			<div class="biome-list missing-list">
				<div
					v-for="biomeId in biomeFinderStore.missingBiomes"
					:key="biomeId"
					class="biome-entry missing-entry"
				>
					<div class="biome-color" :style="getBiomeColorStyle(biomeId)"></div>
					<div class="biome-info">
						<div class="biome-name">{{ settingsStore.getLocalizedName('biome', Identifier.parse(biomeId), false) }}</div>
					</div>
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

.button-row {
	display: flex;
	gap: 0.5rem;
}

.search-button {
	flex: 1;
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

.cancel-button {
	height: 2.5rem;
	padding: 0 0.75rem;
	background-color: rgba(220, 80, 80, 0.7);
	color: white;
	border: none;
	border-radius: 0.3rem;
	cursor: pointer;
	font-size: 1rem;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background-color 0.2s;
}

.cancel-button:hover {
	background-color: rgba(220, 80, 80, 1);
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

.completion-message.partial {
	background-color: rgba(255, 193, 7, 0.2);
	color: rgb(255, 220, 100);
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

.radius-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.radius-input {
	height: 2.5rem;
	width: 7rem;
	padding: 0 0.5rem;
	background-color: rgba(255, 255, 255, 0.1);
	color: white;
	border: 1px solid rgba(255, 255, 255, 0.2);
	border-radius: 0.3rem;
	font-size: 1rem;
	text-align: right;
}

.radius-input:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.radius-input.input-error {
	border-color: rgba(220, 80, 80, 0.8);
}

.radius-error {
	font-size: 0.8rem;
	color: rgb(255, 120, 120);
}

.radius-label {
	font-size: 0.9rem;
	color: rgba(255, 255, 255, 0.7);
}

.biome-section {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.section-header {
	font-size: 0.85rem;
	color: rgba(255, 255, 255, 0.5);
	padding: 0.25rem 0;
	border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.missing-list {
	max-height: 200px;
}

.missing-entry {
	cursor: default;
	opacity: 0.7;
}

.missing-entry:hover {
	background-color: rgba(255, 255, 255, 0.05);
}
</style>
