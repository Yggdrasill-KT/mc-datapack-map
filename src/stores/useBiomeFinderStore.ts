import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useLoadedDimensionStore } from "./useLoadedDimensionStore";
import { useSettingsStore } from "./useSettingsStore";
import { WorldgenRegistries } from "deepslate";

interface BiomeLocation {
	x: number,
	z: number,
	distance: number
}

export const useBiomeFinderStore = defineStore('biome_finder', () => {
	const loadedDimensionStore = useLoadedDimensionStore()
	const settingsStore = useSettingsStore()

	const isSearching = ref(false)
	const progress = ref(0)
	const totalFound = ref(0)
	const totalExpected = ref(0)
	const biomeLocations = ref(new Map<string, BiomeLocation>())
	const allBiomesFound = ref(false)

	let worker: Worker | null = null

	function startSearch() {
		if (isSearching.value) {
			return
		}

		// Clear previous results
		biomeLocations.value.clear()
		progress.value = 0
		totalFound.value = 0
		allBiomesFound.value = false
		isSearching.value = true

		// Get configuration from loaded dimension
		const level_height = loadedDimensionStore.loaded_dimension.level_height
		if (!level_height) {
			console.error("Level height not available")
			isSearching.value = false
			return
		}

		const maxY = level_height.minY + level_height.height - 1

		// Get all biomes from registry
		const allBiomes = WorldgenRegistries.BIOME.keys().map(id => id.toString())
		totalExpected.value = allBiomes.length

		// Prepare density functions
		const densityFunctions: { [key: string]: unknown } = {}
		for (const id of WorldgenRegistries.DENSITY_FUNCTION.keys()) {
			const entry = WorldgenRegistries.DENSITY_FUNCTION.get(id)
			if (entry) {
				densityFunctions[id.toString()] = entry.toJson()
			}
		}

		// Prepare noises
		const noises: { [key: string]: unknown } = {}
		for (const id of WorldgenRegistries.NOISE.keys()) {
			const entry = WorldgenRegistries.NOISE.get(id)
			if (entry) {
				noises[id.toString()] = entry.toJson()
			}
		}

		// Create worker
		worker = new Worker(new URL('../webworker/BiomeFinder.ts', import.meta.url), { type: 'module' })

		worker.onmessage = (evt) => {
			if (evt.data.type === "progress") {
				progress.value = evt.data.progress
				totalFound.value = evt.data.totalFound

				// Update biome locations with newly found biomes
				for (const { biome, x, z, distance } of evt.data.foundBiomes) {
					if (!biomeLocations.value.has(biome)) {
						biomeLocations.value.set(biome, { x, z, distance })
					}
				}
			} else if (evt.data.type === "complete") {
				progress.value = 100
				allBiomesFound.value = evt.data.completed

				// Update with final results
				biomeLocations.value.clear()
				for (const [biome, location] of Object.entries(evt.data.biomes)) {
					biomeLocations.value.set(biome, location as BiomeLocation)
				}

				totalFound.value = biomeLocations.value.size
				isSearching.value = false

				if (worker) {
					worker.terminate()
					worker = null
				}
			} else if (evt.data.type === "cancelled") {
				isSearching.value = false
				if (worker) {
					worker.terminate()
					worker = null
				}
			}
		}

		worker.onerror = (error) => {
			console.error("Biome finder worker error:", error)
			isSearching.value = false
			if (worker) {
				worker.terminate()
				worker = null
			}
		}

		// Send configuration to worker
		worker.postMessage({
			type: "start",
			config: {
				seed: settingsStore.seed,
				biomeSourceJson: loadedDimensionStore.loaded_dimension.biome_source_json,
				noiseGeneratorSettingsJson: loadedDimensionStore.loaded_dimension.noise_settings_json,
				densityFunctions: densityFunctions,
				noises: noises,
				maxRadius: 10000,
				sampleStep: 16,
				maxY: maxY,
				allBiomes: allBiomes
			}
		})
	}

	function cancelSearch() {
		if (worker) {
			worker.postMessage({ type: "cancel" })
		}
		isSearching.value = false
	}

	function clearResults() {
		biomeLocations.value.clear()
		progress.value = 0
		totalFound.value = 0
		totalExpected.value = 0
		allBiomesFound.value = false
	}

	// Clear results when dimension changes
	watch(() => settingsStore.dimension, () => {
		if (isSearching.value) {
			cancelSearch()
		}
		clearResults()
	})

	// Clear results when seed changes
	watch(() => settingsStore.seed, () => {
		if (isSearching.value) {
			cancelSearch()
		}
		clearResults()
	})

	return {
		isSearching,
		progress,
		totalFound,
		totalExpected,
		biomeLocations,
		allBiomesFound,
		startSearch,
		cancelSearch,
		clearResults
	}
})
