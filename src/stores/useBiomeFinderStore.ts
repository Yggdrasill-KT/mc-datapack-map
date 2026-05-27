import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { useLoadedDimensionStore } from "./useLoadedDimensionStore.js";
import { useSettingsStore } from "./useSettingsStore.js";

interface BiomeLocation {
	x: number,
	z: number,
	distance: number
}

function* spiralGenerator(maxRadius: number, step: number) {
	yield { x: 0, z: 0 }
	let x = 0, z = 0
	let dx = 0, dz = -step

	while (Math.abs(x) <= maxRadius || Math.abs(z) <= maxRadius) {
		if (Math.abs(x) <= maxRadius && Math.abs(z) <= maxRadius) {
			yield { x, z }
		}
		if (x === z || (x < 0 && x === -z) || (x > 0 && x === step - z)) {
			[dx, dz] = [-dz, dx]
		}
		x += dx
		z += dz
	}
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
	const searchedRadius = ref(0)
	const searchRadius = ref(10000)
	const allBiomesList = ref<string[]>([])

	const missingBiomes = computed(() => {
		if (isSearching.value || searchedRadius.value === 0) return []
		return allBiomesList.value.filter(b => !biomeLocations.value.has(b))
	})

	let searchCancelled = false

	async function startSearch() {
		if (isSearching.value) return

		biomeLocations.value.clear()
		progress.value = 0
		totalFound.value = 0
		allBiomesFound.value = false
		searchedRadius.value = 0
		isSearching.value = true
		searchCancelled = false

		const level_height = loadedDimensionStore.loaded_dimension.level_height
		if (!level_height) {
			console.error("Level height not available")
			isSearching.value = false
			return
		}

		// Use the same biomeSource and sampler as the map tile system
		const biomeSource = loadedDimensionStore.getBiomeSource()
		if (!biomeSource) {
			console.error("Biome source not available")
			isSearching.value = false
			return
		}

		const sampler = loadedDimensionStore.sampler

		// Extract biome list directly from biome source JSON
		const biomeSourceJson = loadedDimensionStore.loaded_dimension.biome_source_json as any
		let allBiomes: string[] = []
		if (biomeSourceJson?.biomes && Array.isArray(biomeSourceJson.biomes)) {
			// Use Set to deduplicate: same biome appears multiple times with different climate params
			allBiomes = [...new Set(
				(biomeSourceJson.biomes as Array<any>)
					.map(entry => entry.biome as string)
					.filter(Boolean)
			)]
		} else if (typeof biomeSourceJson?.biome === 'string') {
			allBiomes = [biomeSourceJson.biome]
		}

		if (allBiomes.length === 0) {
			console.error("No biomes found in biome source JSON")
			isSearching.value = false
			return
		}

		allBiomesList.value = allBiomes
		const allBiomesSet = new Set(allBiomes)
		totalExpected.value = allBiomes.length

		const minY = level_height.minY
		const maxY = level_height.minY + level_height.height - 1
		const surfaceY = maxY >> 2
		const caveY = 0
		const deepY = minY >> 2

		// Per-Y remaining biome sets for early termination per Y level
		const remainingPerY = new Map<number, Set<string>>([
			[surfaceY, new Set()],
			[caveY,    new Set()],
			[deepY,    new Set()],
		])

		if (biomeSourceJson?.biomes && Array.isArray(biomeSourceJson.biomes)) {
			for (const entry of biomeSourceJson.biomes as Array<any>) {
				const biomeId = entry.biome as string
				if (!allBiomesSet.has(biomeId)) continue
				const depth = entry.parameters?.depth
				const minDepth = Array.isArray(depth) ? depth[0] : (typeof depth === 'number' ? depth : 0)
				const targetY = minDepth >= 1.0 ? deepY : minDepth > 0 ? caveY : surfaceY
				remainingPerY.get(targetY)!.add(biomeId)
			}
		} else {
			// Single-biome source (Nether etc.) — assign all to surface Y
			for (const b of allBiomes) remainingPerY.get(surfaceY)!.add(b)
		}

		let activeYQuarts = [surfaceY, caveY, deepY].filter(y => remainingPerY.get(y)!.size > 0)

		const maxRadius = searchRadius.value
		const sampleStep = 16
		const batchSize = 500

		const stepsPerSide = Math.floor(maxRadius / sampleStep) * 2 + 1
		const totalSamples = stepsPerSide * stepsPerSide
		let sampleCount = 0

		const spiral = spiralGenerator(maxRadius, sampleStep)

		let batchMaxDistance = 0

		while (!searchCancelled) {
			let batchLocalMax = 0

			for (let i = 0; i < batchSize; i++) {
				const result = spiral.next()
				if (result.done) {
					// Spiral exhausted
					searchedRadius.value = maxRadius
					allBiomesFound.value = biomeLocations.value.size === totalExpected.value
					progress.value = 100
					isSearching.value = false
					return
				}

				const { x, z } = result.value
				const distance = Math.sqrt(x * x + z * z)
				if (distance > batchLocalMax) batchLocalMax = distance

				for (const yQuart of activeYQuarts) {
					const biome = biomeSource.getBiome(x >> 2, yQuart, z >> 2, sampler).toString()
					if (!biomeLocations.value.has(biome) && allBiomesSet.has(biome)) {
						biomeLocations.value.set(biome, { x, z, distance })
						totalFound.value = biomeLocations.value.size

						// Remove from all Y remaining sets and refresh active list
						for (const remaining of remainingPerY.values()) remaining.delete(biome)
						activeYQuarts = activeYQuarts.filter(y => remainingPerY.get(y)!.size > 0)

						if (biomeLocations.value.size === totalExpected.value || activeYQuarts.length === 0) {
							batchMaxDistance = Math.max(batchMaxDistance, batchLocalMax)
							const allFound = biomeLocations.value.size === totalExpected.value
							searchedRadius.value = maxRadius
							allBiomesFound.value = allFound
							progress.value = 100
							isSearching.value = false
							return
						}
					}
				}

				sampleCount++
			}

			// Update spatial progress and yield to event loop for UI update
			batchMaxDistance = Math.max(batchMaxDistance, batchLocalMax)
			progress.value = Math.min(99, Math.round((sampleCount / totalSamples) * 100))

			if (activeYQuarts.length === 0) {
				searchedRadius.value = maxRadius
				allBiomesFound.value = biomeLocations.value.size === totalExpected.value
				progress.value = 100
				isSearching.value = false
				return
			}

			await new Promise(r => setTimeout(r, 0))
		}

		searchedRadius.value = Math.round(batchMaxDistance)

		// Cancelled
		isSearching.value = false
	}

	function cancelSearch() {
		searchCancelled = true
		isSearching.value = false
	}

	function clearResults() {
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
		allBiomesList,
		missingBiomes,
		startSearch,
		cancelSearch,
		clearResults
	}
})
