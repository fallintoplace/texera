/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { ComponentFixture, TestBed } from "@angular/core/testing";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { Observable, Subject, of, throwError } from "rxjs";

import { SettingsComponent } from "./settings.component";
import { WorkflowActionService } from "../../../service/workflow-graph/model/workflow-action.service";
import { WorkflowPersistService } from "../../../../common/service/workflow-persist/workflow-persist.service";
import { UserService } from "../../../../common/service/user/user.service";
import { StubUserService } from "../../../../common/service/user/stub-user.service";
import { NotificationService } from "../../../../common/service/notification/notification.service";
import { ExecutionMode, Workflow, WorkflowContent, WorkflowSettings } from "../../../../common/type/workflow";
import { commonTestProviders } from "../../../../common/testing/test-utils";

/**
 * Minimal stand-in for WorkflowActionService covering only the surface
 * SettingsComponent uses. Avoids constructing the real service (and its
 * transitive OperatorMetadataService HTTP request) for these unit tests.
 */
class StubWorkflowActionService {
  private settings: WorkflowSettings = {
    dataTransferBatchSize: 100,
    executionMode: ExecutionMode.PIPELINED,
  };
  private operators: { operatorType: string }[] = [];
  private workflowChangedSubject = new Subject<unknown>();

  getWorkflowSettings(): WorkflowSettings {
    return this.settings;
  }

  getWorkflowContent(): WorkflowContent {
    return { operators: [], operatorPositions: {}, links: [], commentBoxes: [], settings: this.settings };
  }

  getWorkflow(): Workflow {
    return { content: this.getWorkflowContent() } as Workflow;
  }

  setWorkflowDataTransferBatchSize(size: number): void {
    if (size > 0 && size != null) {
      this.settings = { ...this.settings, dataTransferBatchSize: size };
    }
  }

  updateExecutionMode(mode: ExecutionMode): void {
    this.settings = { ...this.settings, executionMode: mode };
  }

  workflowChanged(): Observable<unknown> {
    return this.workflowChangedSubject.asObservable();
  }

  // SettingsComponent inspects the graph to decide whether the workflow
  // contains loop operators. Expose a minimal stub that returns whatever
  // a test has staged via `setOperators`.
  getTexeraGraph(): { getAllOperators: () => { operatorType: string }[] } {
    return { getAllOperators: () => this.operators };
  }

  setOperators(ops: { operatorType: string }[]): void {
    this.operators = ops;
  }

  fireWorkflowChanged(): void {
    this.workflowChangedSubject.next(undefined);
  }
}

describe("SettingsComponent", () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let workflowActionService: StubWorkflowActionService;
  let userService: StubUserService;
  let workflowPersistSpy: { persistWorkflow: ReturnType<typeof vi.fn> };
  let notificationSpy: { error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    workflowPersistSpy = { persistWorkflow: vi.fn().mockReturnValue(of({})) };
    notificationSpy = { error: vi.fn(), info: vi.fn() };

    await TestBed.configureTestingModule({
      providers: [
        { provide: WorkflowActionService, useClass: StubWorkflowActionService },
        { provide: UserService, useClass: StubUserService },
        { provide: WorkflowPersistService, useValue: workflowPersistSpy },
        { provide: NotificationService, useValue: notificationSpy },
        ...commonTestProviders,
      ],
      imports: [SettingsComponent, BrowserAnimationsModule, FormsModule, ReactiveFormsModule],
    }).compileComponents();

    workflowActionService = TestBed.inject(WorkflowActionService) as unknown as StubWorkflowActionService;
    userService = TestBed.inject(UserService) as unknown as StubUserService;
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("should initialize the form from current workflow settings", () => {
    const settings = workflowActionService.getWorkflowContent().settings;
    expect(component.settingsForm.get("dataTransferBatchSize")!.value).toBe(settings.dataTransferBatchSize);
    expect(component.settingsForm.get("executionMode")!.value).toBe(settings.executionMode);
    expect(component.settingsForm.valid).toBe(true);
  });

  it("should mark dataTransferBatchSize invalid when below the minimum", () => {
    const control = component.settingsForm.get("dataTransferBatchSize")!;
    control.setValue(0);
    expect(control.valid).toBe(false);
    expect(control.hasError("min")).toBe(true);

    control.setValue(null);
    expect(control.valid).toBe(false);
    expect(control.hasError("required")).toBe(true);
  });

  it("should push dataTransferBatchSize updates to the workflow service and persist when logged in", () => {
    const setBatchSizeSpy = vi.spyOn(workflowActionService, "setWorkflowDataTransferBatchSize");

    component.confirmUpdateDataTransferBatchSize(42);

    expect(setBatchSizeSpy).toHaveBeenCalledWith(42);
    expect(workflowActionService.getWorkflowSettings().dataTransferBatchSize).toBe(42);
    expect(workflowPersistSpy.persistWorkflow).toHaveBeenCalledTimes(1);
  });

  it("should not update or persist a non-positive batch size", () => {
    const setBatchSizeSpy = vi.spyOn(workflowActionService, "setWorkflowDataTransferBatchSize");

    component.confirmUpdateDataTransferBatchSize(0);

    expect(setBatchSizeSpy).not.toHaveBeenCalled();
    expect(workflowPersistSpy.persistWorkflow).not.toHaveBeenCalled();
  });

  it("should skip persistWorkflow when the user is not logged in", () => {
    userService.user = undefined;
    const setBatchSizeSpy = vi.spyOn(workflowActionService, "setWorkflowDataTransferBatchSize");

    component.confirmUpdateDataTransferBatchSize(7);

    expect(setBatchSizeSpy).toHaveBeenCalledWith(7);
    expect(workflowPersistSpy.persistWorkflow).not.toHaveBeenCalled();
  });

  it("should update the execution mode on the workflow service and persist", () => {
    const updateModeSpy = vi.spyOn(workflowActionService, "updateExecutionMode");

    component.updateExecutionMode(ExecutionMode.MATERIALIZED);

    expect(updateModeSpy).toHaveBeenCalledWith(ExecutionMode.MATERIALIZED);
    expect(workflowActionService.getWorkflowSettings().executionMode).toBe(ExecutionMode.MATERIALIZED);
    expect(workflowPersistSpy.persistWorkflow).toHaveBeenCalledTimes(1);
  });

  it("should surface a notification error when persistWorkflow fails", () => {
    workflowPersistSpy.persistWorkflow.mockReturnValueOnce(throwError(() => new Error("network down")));

    component.persistWorkflow();

    expect(notificationSpy.error).toHaveBeenCalledWith("network down");
  });

  it("should propagate form value changes through to the workflow service", () => {
    const setBatchSizeSpy = vi.spyOn(workflowActionService, "setWorkflowDataTransferBatchSize");
    const updateModeSpy = vi.spyOn(workflowActionService, "updateExecutionMode");

    component.settingsForm.get("dataTransferBatchSize")!.setValue(256);
    component.settingsForm.get("executionMode")!.setValue(ExecutionMode.MATERIALIZED);

    expect(setBatchSizeSpy).toHaveBeenCalledWith(256);
    expect(updateModeSpy).toHaveBeenCalledWith(ExecutionMode.MATERIALIZED);
  });

  it("should ignore form value changes that fail validation", () => {
    const setBatchSizeSpy = vi.spyOn(workflowActionService, "setWorkflowDataTransferBatchSize");

    component.settingsForm.get("dataTransferBatchSize")!.setValue(-5);

    expect(setBatchSizeSpy).not.toHaveBeenCalled();
  });

  // ---- Loop-aware execution mode coercion -------------------------------
  //
  // SettingsComponent must keep the UI and the engine in agreement: a
  // workflow containing Loop Start / Loop End operators always runs in
  // MATERIALIZED mode (server enforces this too). The component coerces
  // the form value, disables the radio group, and shows a one-shot
  // notification when it has to flip the user's selection.

  it("should coerce executionMode to MATERIALIZED and disable the radio group when a LoopStart appears", () => {
    workflowActionService.setOperators([{ operatorType: "LoopStart" }]);
    workflowActionService.fireWorkflowChanged();

    const ctrl = component.settingsForm.get("executionMode")!;
    expect(component.hasLoopOperator).toBe(true);
    expect(workflowActionService.getWorkflowSettings().executionMode).toBe(ExecutionMode.MATERIALIZED);
    expect(ctrl.disabled).toBe(true);
  });

  it("should also trigger on LoopEnd presence, not only LoopStart", () => {
    workflowActionService.setOperators([{ operatorType: "LoopEnd" }]);
    workflowActionService.fireWorkflowChanged();

    expect(component.hasLoopOperator).toBe(true);
    expect(workflowActionService.getWorkflowSettings().executionMode).toBe(ExecutionMode.MATERIALIZED);
  });

  it("should re-enable the radio group when the last loop operator is removed", () => {
    workflowActionService.setOperators([{ operatorType: "LoopStart" }]);
    workflowActionService.fireWorkflowChanged();
    expect(component.settingsForm.get("executionMode")!.disabled).toBe(true);

    workflowActionService.setOperators([]);
    workflowActionService.fireWorkflowChanged();

    expect(component.hasLoopOperator).toBe(false);
    expect(component.settingsForm.get("executionMode")!.disabled).toBe(false);
  });

  it("should surface an info notification exactly once when coercing PIPELINED → MATERIALIZED", () => {
    workflowActionService.setOperators([{ operatorType: "LoopStart" }]);
    workflowActionService.fireWorkflowChanged();
    // Subsequent workflow-changed events that don't change the loop-status
    // must not re-notify (otherwise we'd spam the user on every position
    // change / link add).
    workflowActionService.fireWorkflowChanged();
    workflowActionService.fireWorkflowChanged();

    expect(notificationSpy.info).toHaveBeenCalledTimes(1);
  });

  it("should not notify when a workflow opens already in MATERIALIZED mode with a loop", () => {
    workflowActionService.updateExecutionMode(ExecutionMode.MATERIALIZED);
    workflowActionService.setOperators([{ operatorType: "LoopStart" }]);
    workflowActionService.fireWorkflowChanged();

    expect(component.hasLoopOperator).toBe(true);
    expect(notificationSpy.info).not.toHaveBeenCalled();
  });

  it("should leave executionMode alone when no loop operator is present", () => {
    workflowActionService.setOperators([{ operatorType: "CSVFileScan" }]);
    workflowActionService.fireWorkflowChanged();

    expect(component.hasLoopOperator).toBe(false);
    expect(workflowActionService.getWorkflowSettings().executionMode).toBe(ExecutionMode.PIPELINED);
    expect(component.settingsForm.get("executionMode")!.disabled).toBe(false);
  });
});
