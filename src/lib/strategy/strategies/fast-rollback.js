"use strict";

const _ = require("lodash");
const Annotations = require("../../annotator/annotations");
const EventEmitter = require("events");

const Name = "fast-rollback";

// TODO: May want to make this configurable in the future
const DeployGroupLabelName = "service";
const DeployIdLabelName = "id";
const NumDesiredReserve = 3;

class FastRollback extends EventEmitter {
	constructor(options) {
		super();
		this.options = options;
		this.kubectl = this.options.kubectl;
		this.services = [];
		this.deployments = [];
	}

	get name() {
		return Name;
	}

	annotate(manifest) {
		// If deployment manifest, append the deployId to the name
		const kind = manifest.kind.toLowerCase();
		const deployId = this.options.deployId;
		if (kind === "deployment" && deployId) {
			manifest.metadata.name = `${manifest.metadata.name}-${deployId}`;
		}
		return manifest;
	}

	skipDeploy(manifest, found, differences) {
		const kind = manifest.kind.toLowerCase();
		if (kind === "deployment") {
			// Keep track of deployments because we will need to query for it later
			this.deployments.push({
				manifest: manifest
			});
			// If the deployment manifest already exists with the same deployId we will skip deploying it
			if (found) {
				this.emit("info", `deployment ${manifest.metadata.name} already exists in the cluster so skipping`);
				return true;
			}
		}

		return false;
	}

	preDeploy(manifest, found, differences, tmpApplyingConfigurationPath) {
		const kind = manifest.kind.toLowerCase();
		// Postpone deploy of any services that are NOT new because we want to wait for the deployment to be available first
		if (kind === "service") {
			// If the service is NOT found we will simply deploy the service immediately (no need to wait)
			if (!found) {
				return Promise.resolve(false);
			}
			this.emit("info", `waiting for all deployments to be available before deploying service ${manifest.metadata.name}`);
			this.services.push({
				manifest: manifest,
				tmpPath: tmpApplyingConfigurationPath
			});
			return Promise.resolve(true);
		}

		return Promise.resolve(false);
	}

	allAvailable(manifests) {
		// Deployment manifests are available and we can deploy the services now
		return this.deployServices()
			.then(() => {
				this.emit("info", `deployed ${this.services.length} services after all deployments available`);
				if (this.options.isRollback) {
					return this.deleteNewer();
				} else {
					return this.deleteBackups();
				}
			});
	}

	deployServices() {
		let promises = [];
		// Verify the service's selector selects pods that are available, otherwise reject promise
		let selectors = [];
		_.each(this.services, (service) => {
			for (const prop in service.manifest.spec.selector) {
				selectors.push(`${prop}=${service.manifest.spec.selector[prop]}`);
			}
			const manifestName = service.manifest.metadata.name;
			const selectorString = selectors.join(",")
			promises.push(this.kubectl
				.list("pods", selectorString)
				.then((results) => {
					// If there are results we are going to assume the selector is safe to deploy
					this.emit("info", `verified ${results.items.length} pods match the service selector ${selectorString}`);
					if (!results.items.length) {
						throw new Error(`Service selector ${selectorString} does not match any pods, aborting deploy of service`);
					}
				})
				.then(() => {
					return this.kubectl.get("service", manifestName);
				})
				.then((result) => {
					// If it does not have a last update annotation yet then continue
					if (!_.has(result, ["metadata", "annotations", Annotations.LastUpdated])) {
						return;
					}
					// Check if LastUpdated is newer than when this deploy started
					const currentServiceLastUpdated = new Date(result.metadata.annotations[Annotations.LastUpdated]).getTime();
					const newServiceLastUpdated = new Date(service.manifest.metadata.annotations[Annotations.LastUpdated]).getTime();
					if (currentServiceLastUpdated > newServiceLastUpdated) {
						throw new Error("Aborting because current service has been updated since this deploy has started");
					}
				})
				.then(() => {
					// Deploy service now
					return this.kubectl
						.apply(service.tmpPath)
						.then(() => {
							this.emit("info", `successfully deployed ${service.manifest.metadata.name} service after all deployments were available`);
						});
				}));
		});
		return Promise.all(promises);
	}

	deleteNewer() {
		let promises = [];
		let flaggedForDeletion = [];
		_.each(this.deployments, (deployment) => {
			var creationTimestamp;
			var depSelectors = [];
			promises.push(
				this.kubectl
					.get("deployment", deployment.manifest.metadata.name)
					.then((result) => {
						if (!_.has(result, ["metadata", "creationTimestamp"]) || !result.metadata.creationTimestamp) {
							throw new Error("Missing required creationTimestamp, aborting");
						}
						creationTimestamp = result.metadata.creationTimestamp;
						if (!result.metadata.labels[DeployGroupLabelName] || !result.metadata.labels[DeployIdLabelName]) {
							throw new Error(`Missing required ${DeployGroupLabelName} or ${DeployIdLabelName} label on deployment manifest ${deployment.manifest.metadata.name}`);
						}
						const depSelectorString = `${DeployGroupLabelName}=${result.metadata.labels[DeployGroupLabelName]},${DeployIdLabelName}!=${result.metadata.labels[DeployIdLabelName]}`;
						return this.kubectl
							.list("deployments", depSelectorString)
							.then((results) => {
								let deletePromises = [];
								let verified = FastRollback.verifyGroupDeployments(results.items, deployment.manifest);
								this.emit("info", `found ${verified.length} deployments that match the ${deployment.manifest.metadata.name} deployment group label ${depSelectorString}`);
								// Only select deployments that are newer than the current deployment
								flaggedForDeletion = _.filter(verified, (dep) => {
									return (new Date(dep.metadata.creationTimestamp).getTime() > new Date(creationTimestamp).getTime());
								});
								this.emit("info", `attempting to delete ${flaggedForDeletion.length} deployments newer than ${deployment.manifest.metadata.name}`);
								// Delete all deployments that are newer than the current deployment
								_.each(flaggedForDeletion, (dep) => {
									deletePromises.push(this.kubectl
										.deleteByName("deployment", dep.metadata.name)
										.then(() => {
											this.emit("info", `deleted newer deployment ${dep.metadata.name}`);
										})
									);
								});
								return Promise.all(deletePromises).then(() => {
									if (flaggedForDeletion.length) {
										this.emit("info", `successfully deleted ${flaggedForDeletion.length} deployments newer than ${deployment.manifest.metadata.name}`);
									}
								});
							});
					})
			);
		});
		return Promise.all(promises).then(() => {
			return flaggedForDeletion;
		});
	}

	deleteBackups() {
		let promises = [];
		let flaggedForDeletion = [];
		_.each(this.deployments, (deployment) => {
			var creationTimestamp;
			var depSelectors = [];
			promises.push(
				this.kubectl
					.get("deployment", deployment.manifest.metadata.name)
					.then((result) => {
						if (!_.has(result, ["metadata", "creationTimestamp"]) || !result.metadata.creationTimestamp) {
							throw new Error("Missing required creationTimestamp, aborting");
						}
						creationTimestamp = result.metadata.creationTimestamp;
						if (!result.metadata.labels[DeployGroupLabelName] || !result.metadata.labels[DeployIdLabelName]) {
							throw new Error(`Missing required ${DeployGroupLabelName} or ${DeployIdLabelName} label on deployment manifest ${deployment.manifest.metadata.name}`);
						}
						const depSelectorString = `${DeployGroupLabelName}=${result.metadata.labels[DeployGroupLabelName]},${DeployIdLabelName}!=${result.metadata.labels[DeployIdLabelName]}`;
						return this.kubectl
							.list("deployments", depSelectorString)
							.then((results) => {
								let deletePromises = [];
								let verified = FastRollback.verifyGroupDeployments(results.items, deployment.manifest);
								this.emit("info", `found ${verified.length} backup deployments on reserve that match the ${deployment.manifest.metadata.name} deployment group label ${depSelectorString}`);
								// Sort the list by creationTimestamp
								verified.sort((a, b) => {
									return new Date(a.metadata.creationTimestamp).getTime() - new Date(b.metadata.creationTimestamp).getTime();
								});
								// Delete the oldest deployments while maintaining the desired backups on reserve
								if (verified.length-NumDesiredReserve > 0) {
									flaggedForDeletion = verified.slice(0, verified.length-NumDesiredReserve);
									this.emit("info", `attempting to delete ${flaggedForDeletion.length} deployments older than ${deployment.manifest.metadata.name}`);
									// Extra check to make sure we don't delete more backups than required to be on reserve
									if (verified.length - flaggedForDeletion.length < NumDesiredReserve) {
										throw new Error(`Trying to delete too many deployment backups, aborted`);
									}
								} else {
									this.emit("info", `skipping delete of older deployments because insufficent backup deployments on reserve`);
								}
								_.each(flaggedForDeletion, (dep) => {
									deletePromises.push(this.kubectl
										.deleteByName("deployment", dep.metadata.name)
										.then(() => {
											this.emit("info", `deleted backup deployment ${dep.metadata.name}`);
										})
									);
								});
								return Promise.all(deletePromises).then(() => {
									if (flaggedForDeletion.length) {
										this.emit("info", `successfully deleted ${flaggedForDeletion.length} deployments older than ${deployment.manifest.metadata.name}`);
									}
								});
							});
					})
			);
		});
		return Promise.all(promises).then(() => {
			return flaggedForDeletion;
		});
	}

	// VerifyGroupDeployments will take the given results and make sure they all match the original name of the manifest given
	static verifyGroupDeployments(items, manifest) {
		var verified = [];
		// Exclude the current active deployment
		if (!_.has(manifest, ["metadata", "name"]) && !manifest.metadata.name) {
			throw new Error(`Deployment is missing it's name... huh?!`);
		}
		verified = _.reject(items, {
			metadata: {
				name: manifest.metadata.name
			}
		});

		// Verify these deployments have the same original name as this deployment (just in case the
		// label selector isn't safe enough)
		if (!_.has(manifest, ["metadata", "annotations", Annotations.OriginalName]) && !manifest.metadata.annotations[Annotations.OriginalName]) {
			throw new Error(`Deployment ${manifest.metadata.name} is missing it's original name annotation`);
		}
		verified = _.filter(verified, (dep) => {
			if (_.has(dep, ["metadata", "annotations", Annotations.OriginalName])) {
				return (dep.metadata.annotations[Annotations.OriginalName] == manifest.metadata.annotations[Annotations.OriginalName]);
			}
			return false;
		});
		return verified;
	}
}

module.exports = {
	Name: Name,
	Strategy: FastRollback
};
