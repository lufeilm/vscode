/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as minimist from 'vscode-minimist';
import * as path from 'vs/base/common/path';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { createSyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { Registry } from 'vs/platform/registry/common/platform';
import { ISearchService } from 'vs/workbench/services/search/common/search';
import { ITelemetryInfo, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { testWorkspace } from 'vs/platform/workspace/test/common/testWorkspace';
import { Extensions, IQuickOpenRegistry } from 'vs/workbench/browser/quickopen';
import 'vs/workbench/contrib/search/browser/search.contribution'; // load contributions
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { LocalSearchService } from 'vs/workbench/services/search/node/searchService';
import { IUntitledTextEditorService, UntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { TestContextService, TestEditorGroupsService, TestEditorService, TestTextResourcePropertiesService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestEnvironmentService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { NullLogService } from 'vs/platform/log/common/log';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { INotificationService } from 'vs/platform/notification/common/notification';

namespace Timer {
	export interface ITimerEvent {
		id: number;
		topic: string;
		name: string;
		description: string;
		data: any;

		startTime: Date;
		stopTime: Date;

		stop(stopTime?: Date): void;
		timeTaken(): number;
	}
}

// declare var __dirname: string;

// Checkout sources to run against:
// git clone --separate-git-dir=testGit --no-checkout --single-branch https://chromium.googlesource.com/chromium/src testWorkspace
// cd testWorkspace; git checkout 39a7f93d67f7
// Run from repository root folder with (test.bat on Windows): ./scripts/test.sh --grep QuickOpen.performance --timeout 180000 --testWorkspace <path>
suite.skip('QuickOpen performance (integration)', () => {

	test('Measure', () => {
		if (process.env['VSCODE_PID']) {
			return undefined; // TODO@Christoph find out why test fails when run from within VS Code
		}

		const n = 3;
		const argv = minimist(process.argv);
		const testWorkspaceArg = argv['testWorkspace'];
		const verboseResults = argv['verboseResults'];
		const testWorkspacePath = testWorkspaceArg ? path.resolve(testWorkspaceArg) : __dirname;

		const telemetryService = new TestTelemetryService();
		const configurationService = new TestConfigurationService();
		const textResourcePropertiesService = new TestTextResourcePropertiesService(configurationService);
		const dialogService = new TestDialogService();
		const notificationService = new TestNotificationService();
		const undoRedoService = new UndoRedoService(dialogService, notificationService);
		const instantiationService = new InstantiationService(new ServiceCollection(
			[ITelemetryService, telemetryService],
			[IConfigurationService, configurationService],
			[ITextResourcePropertiesService, textResourcePropertiesService],
			[IDialogService, dialogService],
			[INotificationService, notificationService],
			[IUndoRedoService, undoRedoService],
			[IModelService, new ModelServiceImpl(configurationService, textResourcePropertiesService, new TestThemeService(), new NullLogService(), undoRedoService)],
			[IWorkspaceContextService, new TestContextService(testWorkspace(URI.file(testWorkspacePath)))],
			[IEditorService, new TestEditorService()],
			[IEditorGroupsService, new TestEditorGroupsService()],
			[IEnvironmentService, TestEnvironmentService],
			[IUntitledTextEditorService, createSyncDescriptor(UntitledTextEditorService)],
			[ISearchService, createSyncDescriptor(LocalSearchService)]
		));

		const registry = Registry.as<IQuickOpenRegistry>(Extensions.Quickopen);
		const descriptor = registry.getDefaultQuickOpenHandler();
		assert.ok(descriptor);

		function measure() {
			const handler = descriptor.instantiate(instantiationService);
			handler.onOpen();
			return handler.getResults('a', CancellationToken.None).then(result => {
				const uncachedEvent = popEvent();
				assert.strictEqual(uncachedEvent.data.symbols.fromCache, false, 'symbols.fromCache');
				assert.strictEqual(uncachedEvent.data.files.fromCache, true, 'files.fromCache');
				if (testWorkspaceArg) {
					assert.ok(!!uncachedEvent.data.files.joined, 'files.joined');
				}
				return uncachedEvent;
			}).then(uncachedEvent => {
				return handler.getResults('ab', CancellationToken.None).then(result => {
					const cachedEvent = popEvent();
					assert.strictEqual(uncachedEvent.data.symbols.fromCache, false, 'symbols.fromCache');
					assert.ok(cachedEvent.data.files.fromCache, 'filesFromCache');
					handler.onClose(false);
					return [uncachedEvent, cachedEvent];
				});
			});
		}

		function popEvent() {
			const events = telemetryService.events
				.filter(event => event.name === 'openAnything');
			assert.strictEqual(events.length, 1);
			const event = events[0];
			telemetryService.events.length = 0;
			return event;
		}

		function printResult(data: any) {
			if (verboseResults) {
				console.log(JSON.stringify(data, null, '  ') + ',');
			} else {
				console.log(JSON.stringify({
					filesfromCacheNotJoined: data.files.fromCache && !data.files.joined,
					searchLength: data.searchLength,
					sortedResultDuration: data.sortedResultDuration,
					filesResultCount: data.files.resultCount,
					errorCount: data.files.errors && data.files.errors.length || undefined
				}) + ',');
			}
		}

		return measure() // Warm-up first
			.then(() => {
				if (testWorkspaceArg || verboseResults) { // Don't measure by default
					const cachedEvents: Timer.ITimerEvent[] = [];
					let i = n;
					return (function iterate(): Promise<Timer.ITimerEvent> {
						if (!i--) {
							return undefined!;
						}
						return measure()
							.then(([uncachedEvent, cachedEvent]) => {
								printResult(uncachedEvent.data);
								cachedEvents.push(cachedEvent);
								return iterate();
							});
					})().then(() => {
						console.log();
						cachedEvents.forEach(cachedEvent => {
							printResult(cachedEvent.data);
						});
					});
				}
				return undefined;
			});
	});
});

class TestTelemetryService implements ITelemetryService {

	public _serviceBrand: undefined;
	public isOptedIn = true;

	public events: any[] = [];

	public setEnabled(value: boolean): void {
	}

	public publicLog(eventName: string, data?: any): Promise<void> {
		this.events.push({ name: eventName, data: data });
		return Promise.resolve(undefined);
	}

	public publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLog(eventName, data as any);
	}

	public getTelemetryInfo(): Promise<ITelemetryInfo> {
		return Promise.resolve({
			instanceId: 'someValue.instanceId',
			sessionId: 'someValue.sessionId',
			machineId: 'someValue.machineId'
		});
	}
}
