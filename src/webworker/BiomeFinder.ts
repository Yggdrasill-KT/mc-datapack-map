/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
export { };

import { Climate, DensityFunction, WorldgenRegistries, Identifier, Holder, NoiseGeneratorSettings, RandomState, NoiseParameters, BiomeSource } from "deepslate"

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

class BiomeFinderCalculator {
	private biomeSource?: BiomeSource
	private sampler?: Climate.Sampler
	private levelHeight?: { minY: number, height: number }
	private biomeSourceJson?: any
	private searchCancelled = false

	public update(update: {
		biomeSourceJson?: unknown,
		noiseGeneratorSettingsJson?: unknown,
		densityFunctions?: { [key: string]: unknown },
		noises?: { [key: string]: unknown },
		seed?: bigint,
		levelHeight?: { minY: number, height: number }
	}) {
		if (update.biomeSourceJson !== undefined) {
			this.biomeSource = BiomeSource.fromJson(update.biomeSourceJson)
			this.biomeSourceJson = update.biomeSourceJson
		}

		if (update.densityFunctions) {
			WorldgenRegistries.DENSITY_FUNCTION.clear()
			for (const id in update.densityFunctions) {
				const df = new DensityFunction.HolderHolder(Holder.parser(WorldgenRegistries.DENSITY_FUNCTION, DensityFunction.fromJson)(update.densityFunctions[id]))
				WorldgenRegistries.DENSITY_FUNCTION.register(Identifier.parse(id), df)
			}
		}

		if (update.noises) {
			WorldgenRegistries.NOISE.clear()
			for (const id in update.noises) {
				const noise = NoiseParameters.fromJson(update.noises[id])
				WorldgenRegistries.NOISE.register(Identifier.parse(id), noise)
			}
		}

		if (update.noiseGeneratorSettingsJson !== undefined && update.seed !== undefined) {
			const noiseGeneratorSettings = NoiseGeneratorSettings.fromJson(update.noiseGeneratorSettingsJson)
			const randomState = new RandomState(noiseGeneratorSettings, update.seed)
			this.sampler = Climate.Sampler.fromRouter(randomState.router)
		}

		if (update.levelHeight) {
			this.levelHeight = update.levelHeight
		}
	}

	public cancelSearch() {
		this.searchCancelled = true
	}

	public async startSearch(searchRadius: number, centerX: number, centerZ: number, generation: number) {
		this.searchCancelled = false

		if (!this.biomeSource || !this.sampler || !this.levelHeight || !this.biomeSourceJson) {
			console.error("[BiomeFinder Worker] Not initialized")
			return
		}

		const biomeSource = this.biomeSource
		const sampler = this.sampler
		const levelHeight = this.levelHeight
		const biomeSourceJson = this.biomeSourceJson

		let allBiomes: string[] = []
		if (biomeSourceJson?.biomes && Array.isArray(biomeSourceJson.biomes)) {
			allBiomes = [...new Set(
				(biomeSourceJson.biomes as Array<any>)
					.map((entry: any) => entry.biome as string)
					.filter(Boolean)
			)]
		} else if (typeof biomeSourceJson?.biome === 'string') {
			allBiomes = [biomeSourceJson.biome]
		}

		if (allBiomes.length === 0) {
			console.error("[BiomeFinder Worker] No biomes found")
			return
		}

		postMessage({ type: 'biomeList', biomes: allBiomes, totalExpected: allBiomes.length, generation })

		const allBiomesSet = new Set(allBiomes)
		const minY = levelHeight.minY
		const maxY = levelHeight.minY + levelHeight.height - 1
		const surfaceY = maxY >> 2
		const caveY = 0
		const deepY = minY >> 2

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
			for (const b of allBiomes) remainingPerY.get(surfaceY)!.add(b)
		}

		let activeYQuarts = [surfaceY, caveY, deepY].filter(y => remainingPerY.get(y)!.size > 0)

		const maxRadius = searchRadius
		const sampleStep = 16
		const batchSize = 500

		const stepsPerSide = Math.floor(maxRadius / sampleStep) * 2 + 1
		const totalSamples = stepsPerSide * stepsPerSide
		let sampleCount = 0

		const spiral = spiralGenerator(maxRadius, sampleStep)
		const foundBiomes = new Set<string>()
		let totalFound = 0
		let batchMaxDistance = 0
		let maxFoundDistance = 0

		while (!this.searchCancelled) {
			let batchLocalMax = 0

			for (let i = 0; i < batchSize; i++) {
				const result = spiral.next()
				if (result.done) {
					postMessage({ type: 'done', searchedRadius: maxRadius, allBiomesFound: totalFound === allBiomes.length, generation })
					return
				}

				const { x, z } = result.value
				const wx = centerX + x
				const wz = centerZ + z
				const distance = Math.sqrt(x * x + z * z)
				if (distance > batchLocalMax) batchLocalMax = distance

				for (const yQuart of activeYQuarts) {
					const biome = biomeSource.getBiome(wx >> 2, yQuart, wz >> 2, sampler).toString()
					if (!foundBiomes.has(biome) && allBiomesSet.has(biome)) {
						foundBiomes.add(biome)
						totalFound++
						if (distance > maxFoundDistance) maxFoundDistance = distance
						postMessage({ type: 'found', biome, x: wx, z: wz, distance, generation })

						for (const remaining of remainingPerY.values()) remaining.delete(biome)
						activeYQuarts = activeYQuarts.filter(y => remainingPerY.get(y)!.size > 0)

						if (totalFound === allBiomes.length || activeYQuarts.length === 0) {
							postMessage({ type: 'done', searchedRadius: Math.round(maxFoundDistance), allBiomesFound: true, generation })
							return
						}
					}
				}

				sampleCount++
			}

			batchMaxDistance = Math.max(batchMaxDistance, batchLocalMax)
			postMessage({ type: 'progress', progress: Math.min(99, Math.round((sampleCount / totalSamples) * 100)), totalFound, generation })

			if (activeYQuarts.length === 0) {
				postMessage({ type: 'done', searchedRadius: Math.round(maxFoundDistance), allBiomesFound: true, generation })
				return
			}

			await new Promise(r => setTimeout(r, 0))
		}

		postMessage({ type: 'cancelled', searchedRadius: Math.round(batchMaxDistance), generation })
	}
}

const calculator = new BiomeFinderCalculator()

self.onmessage = (evt: ExtendableMessageEvent) => {
	if ('update' in evt.data) {
		calculator.update(evt.data.update)
	} else if ('start' in evt.data) {
		calculator.startSearch(evt.data.start.searchRadius, evt.data.start.centerX, evt.data.start.centerZ, evt.data.start.generation)
	} else if ('cancel' in evt.data) {
		calculator.cancelSearch()
	}
}
