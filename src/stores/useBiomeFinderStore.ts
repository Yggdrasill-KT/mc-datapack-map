import { defineStore } from "pinia";
import { ref, computed, watch, toRaw } from "vue";
import { useLoadedDimensionStore } from "./useLoadedDimensionStore.js";
import { useSettingsStore } from "./useSettingsStore.js";
import { useDatapackStore } from "./useDatapackStore.js";
import { ResourceLocation } from "mc-datapack-loader";
import BiomeFinderWorker from "../webworker/BiomeFinder?worker";

interface BiomeLocation {
	x: number,
	z: number,
	distance: number
}

export const useBiomeFinderStore = defineStore('biome_finder', () => {
	const loadedDimensionStore = useLoadedDimensionStore()
	const settingsStore = useSettingsStore()
	const datapackStore = useDatapackStore()

	const isSearching = ref(false)
	const progress = ref(0)
	const totalFound = ref(0)
	const totalExpected = ref(0)
	const biomeLocations = ref(new Map<string, BiomeLocation>())
	const allBiomesFound = ref(false)
	const searchedRadius = ref(0)
	const searchRadius = ref(10000)
	const centerX = ref(0)
	const centerZ = ref(0)
	const allBiomesList = ref<string[]>([])

	const missingBiomes = computed(() => {
		if (isSearching.value || searchedRadius.value === 0) return []
		return allBiomesList.value.filter(b => !biomeLocations.value.has(b))
	})

	let searchGeneration = 0

	const worker = new BiomeFinderWorker()
	worker.onmessage = (evt) => {
		const msg = evt.data
		if (msg.generation !== searchGeneration) return

		if (msg.type === 'biomeList') {
			allBiomesList.value = msg.biomes
			totalExpected.value = msg.totalExpected
		} else if (msg.type === 'found') {
			biomeLocations.value.set(msg.biome, { x: msg.x, z: msg.z, distance: msg.distance })
			totalFound.value = biomeLocations.value.size
		} else if (msg.type === 'progress') {
			progress.value = msg.progress
			totalFound.value = msg.totalFound
		} else if (msg.type === 'done') {
			searchedRadius.value = msg.searchedRadius
			allBiomesFound.value = msg.allBiomesFound
			progress.value = 100
			isSearching.value = false
		} else if (msg.type === 'cancelled') {
			searchedRadius.value = msg.searchedRadius
			isSearching.value = false
		}
	}

	async function buildWorkerUpdate() {
		const densityFunctions: { [id: string]: unknown } = {}
		for (const id of await datapackStore.composite_datapack.getIds(ResourceLocation.WORLDGEN_DENSITY_FUNCTION)) {
			densityFunctions[id.toString()] = await datapackStore.composite_datapack.get(ResourceLocation.WORLDGEN_DENSITY_FUNCTION, id)
		}

		const noises: { [id: string]: unknown } = {}
		for (const id of await datapackStore.composite_datapack.getIds(ResourceLocation.WORLDGEN_NOISE)) {
			noises[id.toString()] = await datapackStore.composite_datapack.get(ResourceLocation.WORLDGEN_NOISE, id)
		}

		const levelHeight = loadedDimensionStore.loaded_dimension.level_height
		return {
			biomeSourceJson: toRaw(loadedDimensionStore.loaded_dimension.biome_source_json),
			noiseGeneratorSettingsJson: toRaw(loadedDimensionStore.loaded_dimension.noise_settings_json),
			seed: settingsStore.seed,
			levelHeight: levelHeight ? { minY: levelHeight.minY, height: levelHeight.height } : undefined,
			densityFunctions,
			noises
		}
	}

	async function startSearch() {
		if (isSearching.value) return

		biomeLocations.value.clear()
		progress.value = 0
		totalFound.value = 0
		allBiomesFound.value = false
		searchedRadius.value = 0
		isSearching.value = true
		searchGeneration++
		const myGeneration = searchGeneration

		const level_height = loadedDimensionStore.loaded_dimension.level_height
		if (!level_height) {
			console.error("Level height not available")
			isSearching.value = false
			return
		}

		const update = await buildWorkerUpdate()

		if (myGeneration !== searchGeneration) return

		worker.postMessage({ update })
		worker.postMessage({ start: { searchRadius: searchRadius.value, centerX: centerX.value, centerZ: centerZ.value, generation: myGeneration } })
	}

	function cancelSearch() {
		worker.postMessage({ cancel: true })
		isSearching.value = false
	}

	function clearResults() {
		searchGeneration++
		biomeLocations.value.clear()
		progress.value = 0
		totalFound.value = 0
		totalExpected.value = 0
		allBiomesFound.value = false
		searchedRadius.value = 0
		allBiomesList.value = []
	}

	watch(() => settingsStore.dimension, () => {
		if (isSearching.value) cancelSearch()
		clearResults()
	})

	watch(() => settingsStore.seed, () => {
		if (isSearching.value) cancelSearch()
		clearResults()
	})

	return {
		isSearching,
		progress,
		totalFound,
		totalExpected,
		biomeLocations,
		allBiomesFound,
		searchedRadius,
		searchRadius,
		centerX,
		centerZ,
		allBiomesList,
		missingBiomes,
		startSearch,
		cancelSearch,
		clearResults
	}
})
